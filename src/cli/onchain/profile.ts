import fs from 'node:fs/promises'
import { getAddress } from 'viem'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import { continuityVaultStatus } from '../../identity/continuity/storage/status.js'
import { resolveUploadCredential, resolveValidatedPinataJwt } from '../../identity/storage/pinataJwt.js'
import { validateAgentIconReference, isAgentIconUrl } from '../../identity/profile/agentIcon.js'
import { resolveAgentIconPath, deriveAgentName } from '../../identity/manager/shared/effects/profilePrep.js'
import { runRebackupSigningInSession } from '../../identity/manager/continuity/effects.js'
import { runOperatorWalletRebackup } from '../../identity/manager/continuity/vault.js'
import {
  advancedCustodyEnsAvailable,
  snapshotSaveRequiresOwnerSigner,
  snapshotSaveWalletRole,
} from '../../identity/manager/continuity/snapshot.js'
import { resolveVaultAddress } from '../../identity/manager/custody/transactions.js'
import { readCustodyMode } from '../../identity/manager/custody/state.js'
import { normalizeApprovedOperatorWallets } from '../../identity/manager/shared/operatorWallets.js'
import type { ProfileUpdates, Step } from '../../identity/manager/reducer.js'
import { createLocalKeySignAndTransaction } from '../../identity/wallet/localKeyWallet.js'
import { openBrowserWalletSession, type BrowserWalletReady, type BrowserWalletSession } from '../../identity/wallet/browserWallet.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import { pullHarnessSoulMemoryIntoVault } from '../sync.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from '../history/shared.js'
import { quietCallbacks, requireOperatorKey, requireStorage, walletCancelled, WalletTab } from './shared.js'

export const PROFILE_USAGE = 'ethagent profile [--name <text>] [--description <text>] [--image <path|url|none>] [--operator] [--yes] [--no-open] [--json]'

const HELP = [
  `usage: ${PROFILE_USAGE}`,
  '',
  '  ethagent profile                 the public name, description, image, and agent card. Read-only.',
  '  ethagent profile --name <text> --description <text> --image <path|url|none>',
  '                                   change any of them, then publish in one save. --image none',
  '                                   removes the image. Previews until --yes; nothing is sent when',
  '                                   nothing changes.',
  '',
  'The owner wallet signs in one browser tab. With --operator the operator key signs with no',
  'popup, which needs advanced custody, a linked ENS name, and the key approved as an operator.',
  '',
].join('\n')

export type ProfileSeams = {
  publishOwner: typeof runRebackupSigningInSession
  publishOperator: typeof runOperatorWalletRebackup
  operatorRunner: typeof createLocalKeySignAndTransaction
  resolveJwt: typeof resolveValidatedPinataJwt
  vaultStatus: typeof continuityVaultStatus
  pullHarness: typeof pullHarnessSoulMemoryIntoVault
  imageExists: (path: string) => Promise<boolean>
  openSession: (onReady: (ready: BrowserWalletReady) => void) => Promise<BrowserWalletSession>
  openExternal: (url: string) => void
  saveConfig: (config: EthagentConfig) => Promise<void>
}

export const defaultSeams: ProfileSeams = {
  publishOwner: runRebackupSigningInSession,
  publishOperator: runOperatorWalletRebackup,
  operatorRunner: createLocalKeySignAndTransaction,
  resolveJwt: resolveUploadCredential,
  vaultStatus: continuityVaultStatus,
  pullHarness: pullHarnessSoulMemoryIntoVault,
  imageExists: async file => fs.stat(file).then(stat => stat.isFile(), () => false),
  openSession: onReady => openBrowserWalletSession({ title: 'ethagent profile', onReady }),
  openExternal: url => openExternalUrl(url),
  saveConfig,
}

function readProfile(identity: EthagentIdentity): { name: string; description: string; image: string | null; agentCard: string | null } {
  const state = (identity.state ?? {}) as Record<string, unknown>
  return {
    name: typeof state.name === 'string' && state.name.trim() ? state.name.trim() : deriveAgentName(identity),
    description: typeof state.description === 'string' ? state.description : '',
    image: typeof state.imageUrl === 'string' && state.imageUrl ? state.imageUrl : null,
    agentCard: identity.agentCard?.cid ?? null,
  }
}

// Why the operator key cannot sign this profile change, in the order a user would fix it.
function operatorBlockers(identity: EthagentIdentity, updates: ProfileUpdates, keyAddress: string): string[] {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const out: string[] = []
  if (readCustodyMode(state) !== 'advanced') out.push('custody is not advanced (`ethagent custody --advanced`)')
  if (!(typeof state.ensName === 'string' && state.ensName.trim())) out.push('no ENS name is linked (`ethagent ens <name>`)')
  const approved = normalizeApprovedOperatorWallets(state.approvedOperatorWallets)
  if (!approved.some(record => record.address.toLowerCase() === keyAddress.toLowerCase())) {
    out.push(`the operator key ${keyAddress} is not an approved operator (\`ethagent custody --add-operator --operator\`)`)
  }
  if (out.length === 0 && snapshotSaveRequiresOwnerSigner(identity, updates)) out.push('this change needs the owner wallet')
  if (out.length === 0 && !advancedCustodyEnsAvailable(identity)) out.push('advanced custody with an ENS name is not set up')
  if (out.length === 0 && snapshotSaveWalletRole(identity, updates) !== 'operator') {
    out.push('the owner has not saved since this operator was approved, so the snapshot has no slot for it (`ethagent save` with the owner wallet)')
  }
  return out
}

export async function runProfileCommand(args: string[], deps: HistoryDeps, seams: ProfileSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      name: { type: 'string' },
      description: { type: 'string' },
      image: { type: 'string' },
      operator: { type: 'boolean' },
      yes: { type: 'boolean' },
      'no-open': { type: 'boolean' },
    }, PROFILE_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length > 0) throw new HistoryError(2, `unexpected argument: ${positionals[0]}`, `usage: ${PROFILE_USAGE}`)
    const { config, identity } = await requireIdentity(deps)
    const current = readProfile(identity)
    const editing = values.name !== undefined || values.description !== undefined || values.image !== undefined
    if (!editing) {
      if (json) await emitJson(deps.io, { agentId: identity.agentId ?? null, ...current })
      else await deps.io.out(`${current.name}\n${current.description || '(no description)'}\nimage: ${current.image ?? 'none'}\nagent card: ${current.agentCard ?? 'not published'}\n`)
      return 0
    }
    if (!identity.agentId) throw new HistoryError(1, 'This identity has no agent token ID yet.', 'Create or restore it first.')
    const registry = resolveRegistryForIdentity(identity, config)
    if (!registry) throw new HistoryError(1, 'No agent registry is configured for this identity.')

    const updates: ProfileUpdates = {}
    const changes: Array<{ field: string; from: string | null; to: string | null }> = []
    if (typeof values.name === 'string') {
      const name = values.name.trim()
      if (name.length < 2) throw new HistoryError(2, '--name needs at least 2 characters')
      if (name !== current.name) {
        updates.name = name
        changes.push({ field: 'name', from: current.name, to: name })
      }
    }
    if (typeof values.description === 'string') {
      const description = values.description.trim()
      if (description !== current.description.trim()) {
        updates.description = description
        changes.push({ field: 'description', from: current.description || null, to: description || null })
      }
    }
    if (typeof values.image === 'string') {
      const raw = values.image.trim()
      if (raw === 'none') {
        if (current.image) {
          updates.imagePath = 'delete'
          changes.push({ field: 'image', from: current.image, to: null })
        }
      } else {
        const problem = validateAgentIconReference(raw)
        if (problem) throw new HistoryError(2, `--image: ${problem}`)
        if (!isAgentIconUrl(raw) && !await seams.imageExists(resolveAgentIconPath(raw))) {
          throw new HistoryError(2, `--image: no file at ${resolveAgentIconPath(raw)}`)
        }
        if (raw !== current.image) {
          updates.imagePath = isAgentIconUrl(raw) ? raw : resolveAgentIconPath(raw)
          changes.push({ field: 'image', from: current.image, to: isAgentIconUrl(raw) ? raw : `${resolveAgentIconPath(raw)} (pinned to IPFS on save)` })
        }
      }
    }

    const operator = values.operator ? requireOperatorKey(deps, 'profile') : undefined
    if (operator && changes.length > 0) {
      const blockers = operatorBlockers(identity, updates, operator.address)
      if (blockers.length > 0) {
        throw new HistoryError(1, `The operator key cannot publish this profile change: ${blockers.join('; ')}.`, 'Run without --operator to sign with the owner wallet. Nothing was pinned or sent.')
      }
    }
    const summary = {
      changes,
      signer: operator ? { kind: 'operator', address: operator.address } : { kind: 'browser', wallet: 'owner' },
    }
    if (changes.length === 0) {
      if (json) await emitJson(deps.io, { applied: false, ...summary, reason: 'no-changes' })
      else await deps.io.out('Nothing to change: the profile already matches.\n')
      return 0
    }
    if (!values.yes) {
      if (json) {
        await emitJson(deps.io, { applied: false, ...summary })
      } else {
        const lines = [`Preview (nothing pinned or sent). Signer: ${operator ? `operator key ${operator.address}` : 'owner wallet, in the browser'}.`]
        for (const change of changes) lines.push(`  ${change.field}: ${change.from ?? '(none)'} -> ${change.to ?? '(none)'}`)
        lines.push('Publishing saves a new snapshot of the agent. Run again with --yes to publish.')
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }

    const vault = await seams.vaultStatus(identity).catch(() => ({ ready: false }))
    if (!vault.ready) throw new HistoryError(1, 'Local continuity files are not restored.', 'Run `ethagent restore` first. Nothing was sent.')
    const jwt = await requireStorage(seams.resolveJwt)
    await seams.pullHarness(identity).catch(() => [])

    const vaultAddress = resolveVaultAddress(identity, config.erc8004?.operatorVaults)
    const step: Extract<Step, { kind: 'rebackup-signing' }> = {
      kind: 'rebackup-signing',
      identity,
      registry,
      pinataJwt: jwt,
      profileUpdates: updates,
      returnTo: { kind: 'menu' },
      ...(vaultAddress ? { vaultAddress } : {}),
    }
    let saved: EthagentIdentity | undefined
    const callbacks = quietCallbacks({
      onIdentityComplete: async next => {
        await seams.saveConfig({ ...config, identity: next })
        saved = next
      },
    })
    const tab = new WalletTab(seams.openSession, deps.io, json, Boolean(values['no-open']), seams.openExternal)
    try {
      if (operator) {
        await seams.publishOperator({
          step,
          callbacks,
          walletPurpose: 'update-profile-operator',
          deriveAgentName,
          signAndTransaction: seams.operatorRunner({ privateKey: operator.key, rpcUrl: registry.rpcUrl, chainId: registry.chainId }),
        })
      } else {
        await seams.publishOwner(step, callbacks, await tab.get())
      }
    } catch (err: unknown) {
      const cancelled = walletCancelled(err, [])
      if (cancelled) throw cancelled
      throw err
    } finally {
      await tab.close()
    }
    if (!saved) throw new HistoryError(1, 'The profile save did not complete; nothing was recorded.')
    const result = { applied: true, ...summary, cid: saved.backup?.cid ?? null, txHash: saved.backup?.txHash ?? null, owner: getAddress(saved.ownerAddress ?? saved.address) }
    if (json) await emitJson(deps.io, result)
    else await deps.io.out(`Profile published${result.txHash ? ` (tx ${result.txHash})` : ''}.\n`)
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
