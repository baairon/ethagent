import { getAddress, type Address, type PublicClient } from 'viem'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import { createMainnetClient, validateAgentEnsLink } from '../../identity/ens/ensLookup.js'
import { readAddressRecord, readTextRecords } from '../../identity/ens/ensAutomation/read.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import { DEFAULT_ETHEREUM_RPC_URL, type Erc8004RegistryConfig } from '../../identity/registry/erc8004.js'
import { humanOwnerAddress } from '../../identity/manager/custody/helpers.js'
import { readIdentityStateString } from '../../identity/manager/custody/state.js'
import { resolveVaultAddress } from '../../identity/manager/custody/transactions.js'
import { ensValidationReasonText } from '../../identity/manager/ens/state.js'
import { agentEnsRecordKeys } from '../../identity/manager/ens/records.js'
import { createMainnetEnsPublicClient, sendEnsTransaction } from '../../identity/manager/ens/transactions.js'
import { browserEnsSigner, operatorEnsSigner, type EnsSigner } from '../../identity/manager/ens/signer.js'
import {
  EnsPlanRefusal,
  planEnsRecords,
  planEnsSwap,
  planEnsUnlink,
  readNameControl,
  signerControlOf,
  simulatePlannedTransaction,
  type EnsPlannedTransaction,
} from '../../identity/manager/ens/headless.js'
import { runRebackupSigningInSession } from '../../identity/manager/continuity/effects.js'
import { isWalletCancelled } from '../../identity/manager/shared/utils.js'
import type { EffectCallbacks } from '../../identity/manager/shared/effects/types.js'
import type { Step } from '../../identity/manager/reducer.js'
import { continuityVaultStatus } from '../../identity/continuity/storage/status.js'
import { resolveValidatedPinataJwt } from '../../identity/storage/pinataJwt.js'
import { openBrowserWalletSession, type BrowserWalletSession, type BrowserWalletReady } from '../../identity/wallet/browserWallet.js'
import { createLocalKeySender, type LocalKeySender } from '../../identity/wallet/localKeyWallet.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import { INVALID_OPERATOR_KEY_MESSAGE, OPERATOR_KEY_ENV } from '../operatorKey.js'
import { pullHarnessSoulMemoryIntoVault } from '../sync.js'
import {
  emitJson,
  failFrom,
  HistoryError,
  parseHistoryArgs,
  requireIdentity,
  stringValues,
  type HistoryDeps,
} from '../history/shared.js'

export const ENS_USAGE = 'ethagent ens [<name> | --unlink | --set <key>=<value>... --clear <key>...] [--operator] [--yes] [--no-open] [--json]'

const HELP = [
  `usage: ${ENS_USAGE}`,
  '',
  '  ethagent ens                     the linked name, its live records, the two-way check, the',
  '                                   resolver, who controls the name, and whether the operator',
  '                                   key could sign for it. Read-only.',
  '  ethagent ens <name>              point the agent at <name>: create it when missing (under a',
  '                                   parent the signer controls), write the agent records on it',
  '                                   in one resolver multicall, clear them on the old name, then',
  '                                   publish the name in one owner-signed save.',
  '  ethagent ens --unlink            clear the agent records on the linked name, then publish',
  '                                   the unlinked state in one owner-signed save.',
  '  ethagent ens --set <key>=<value> --clear <key>',
  '                                   write every record change on the linked name in one',
  '                                   resolver multicall. No save is needed.',
  '',
  'Writes preview first and send nothing without --yes. ENS transactions are signed by the',
  'browser wallet, or with --operator by the operator key (run through `keychain exec ethagent',
  '-- ethagent ens <args> --operator`, which injects ' + OPERATOR_KEY_ENV + '). The operator key only',
  'writes text records and creates subnames under a parent it controls. Publishing a name',
  'change always needs the owner wallet.',
  '',
].join('\n')

export type EnsSeams = {
  ensClient: () => PublicClient
  readClient: () => Pick<PublicClient, 'readContract' | 'getEnsAddress' | 'call'>
  operatorSender: (privateKey: `0x${string}`) => LocalKeySender
  openSession: (onReady: (ready: BrowserWalletReady) => void) => Promise<BrowserWalletSession>
  publish: typeof runRebackupSigningInSession
  resolveJwt: typeof resolveValidatedPinataJwt
  vaultStatus: typeof continuityVaultStatus
  pullHarness: typeof pullHarnessSoulMemoryIntoVault
  openExternal: (url: string) => void
  saveConfig: (config: EthagentConfig) => Promise<void>
}

const defaultSeams: EnsSeams = {
  ensClient: () => createMainnetEnsPublicClient(),
  readClient: () => createMainnetClient(),
  operatorSender: privateKey => createLocalKeySender({ privateKey, chainId: 1, rpcUrl: DEFAULT_ETHEREUM_RPC_URL }),
  openSession: onReady => openBrowserWalletSession({ title: 'ethagent ENS', onReady }),
  publish: runRebackupSigningInSession,
  resolveJwt: resolveValidatedPinataJwt,
  vaultStatus: continuityVaultStatus,
  pullHarness: pullHarnessSoulMemoryIntoVault,
  openExternal: url => openExternalUrl(url),
  saveConfig,
}

type Mode = { kind: 'read' } | { kind: 'swap'; name: string } | { kind: 'unlink' } | { kind: 'records'; set: Record<string, string>; clear: string[] }

function parseMode(values: Record<string, unknown>, positionals: string[]): Mode {
  const sets = stringValues(values.set as string | string[] | undefined)
  const clears = stringValues(values.clear as string | string[] | undefined)
  const unlink = Boolean(values.unlink)
  const name = positionals[0]
  if (positionals.length > 1) throw new HistoryError(2, `unexpected argument: ${positionals[1]}`, `usage: ${ENS_USAGE}`)
  const chosen = [name ? 'a name' : '', unlink ? '--unlink' : '', sets.length + clears.length > 0 ? '--set/--clear' : ''].filter(Boolean)
  if (chosen.length > 1) throw new HistoryError(2, `choose one of ${chosen.join(', ')}`, `usage: ${ENS_USAGE}`)
  if (name) return { kind: 'swap', name }
  if (unlink) return { kind: 'unlink' }
  if (sets.length + clears.length > 0) {
    const set: Record<string, string> = {}
    for (const entry of sets) {
      const eq = entry.indexOf('=')
      if (eq <= 0) throw new HistoryError(2, `--set expects <key>=<value>, got: ${entry}`)
      set[entry.slice(0, eq).trim()] = entry.slice(eq + 1)
    }
    for (const key of clears) {
      if (key in set) throw new HistoryError(2, `${key} is both set and cleared`)
    }
    return { kind: 'records', set, clear: clears.map(key => key.trim()).filter(Boolean) }
  }
  return { kind: 'read' }
}

type SignerChoice =
  | { kind: 'browser'; address: Address; role: string }
  | { kind: 'operator'; address: Address; role: string; key: `0x${string}` }

function chooseSigner(deps: HistoryDeps, operator: boolean, owner: Address): SignerChoice {
  if (!operator) return { kind: 'browser', address: owner, role: 'owner wallet' }
  const key = deps.operatorKey
  if (!key || (!key.ok && key.reason === 'missing')) {
    throw new HistoryError(3, 'No operator key available.', `Run this through \`keychain exec ethagent -- ethagent ens <args> --operator\`, which injects ${OPERATOR_KEY_ENV}.`)
  }
  if (!key.ok) throw new HistoryError(2, INVALID_OPERATOR_KEY_MESSAGE)
  return { kind: 'operator', address: getAddress(key.address), role: 'operator key', key: key.key }
}

function txJson(tx: EnsPlannedTransaction, simulation?: { ok: true } | { ok: false; reason: string } | 'after-previous'): Record<string, unknown> {
  return {
    step: tx.step,
    name: tx.name,
    to: tx.to,
    description: tx.description,
    ...(simulation === undefined ? {} : {
      simulation: simulation === 'after-previous'
        ? 'runs after the step before it'
        : simulation.ok ? 'would succeed' : `refused: ${simulation.reason}`,
    }),
  }
}

async function readView(identity: EthagentIdentity, registry: Erc8004RegistryConfig, deps: HistoryDeps, seams: EnsSeams): Promise<Record<string, unknown>> {
  const state = identity.state as Record<string, unknown> | undefined
  const name = readIdentityStateString(state, 'ensName')
  const owner = getAddress(humanOwnerAddress(identity))
  if (!name) return { name: null, owner }
  const client = seams.readClient()
  const control = await readNameControl(client, name)
  const keys = identity.agentId ? agentEnsRecordKeys(registry.identityRegistryAddress, identity.agentId) : []
  const records = control.resolver ? await readTextRecords(client, control.resolver, control.node, keys) : {}
  const addr = control.resolver ? await readAddressRecord(client, control.resolver, control.node) : null
  const validation = await validateAgentEnsLink(name, owner, { publicClient: client as PublicClient })
  const key = deps.operatorKey
  let operator: Record<string, unknown> | null = null
  if (key?.ok) {
    const how = await signerControlOf(client, control, getAddress(key.address))
    operator = { address: getAddress(key.address), canSign: Boolean(how), via: how }
  } else if (key && !key.ok && key.reason === 'invalid') {
    operator = { error: INVALID_OPERATOR_KEY_MESSAGE }
  }
  return {
    name: control.name,
    owner,
    exists: control.exists,
    records: { addr, text: records },
    link: validation.ok
      ? { ok: true, resolvedAddress: validation.resolvedAddress }
      : { ok: false, reason: validation.reason, text: ensValidationReasonText(validation.reason), ...(validation.detail ? { detail: validation.detail } : {}) },
    resolver: control.resolver,
    control: { owner: control.owner, wrapped: control.wrapped, registryOwner: control.registryOwner },
    operator,
  }
}

function printView(view: Record<string, unknown>): string {
  if (!view.name) return `no ENS name is linked · owner ${String(view.owner)}\n`
  const lines: string[] = []
  const link = view.link as { ok: boolean; text?: string; detail?: string }
  const records = view.records as { addr: string | null; text: Record<string, string> }
  const control = view.control as { owner: string | null; wrapped: boolean }
  lines.push(`${String(view.name)} · ${link.ok ? 'linked both ways' : `not linked: ${link.text}${link.detail ? ` (${link.detail})` : ''}`}`)
  lines.push(`  addr: ${records.addr ?? 'none'}`)
  const entries = Object.entries(records.text)
  if (entries.length === 0) lines.push('  agent records: none')
  for (const [key, value] of entries) lines.push(`  ${key} = ${value}`)
  lines.push(`  resolver: ${String(view.resolver ?? 'none')}`)
  lines.push(`  controlled by: ${control.owner ?? 'nobody'}${control.wrapped ? ' (wrapped)' : ''}`)
  const operator = view.operator as { address?: string; canSign?: boolean; via?: string; error?: string } | null
  if (operator?.error) lines.push(`  operator key: ${operator.error}`)
  else if (operator) lines.push(`  operator key ${operator.address}: ${operator.canSign ? `can sign (${operator.via})` : 'cannot sign for this name'}`)
  else lines.push('  operator key: not available in this shell')
  return `${lines.join('\n')}\n`
}

export async function runEnsCommand(args: string[], deps: HistoryDeps, seams: EnsSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      operator: { type: 'boolean' },
      yes: { type: 'boolean' },
      unlink: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      set: { type: 'string', multiple: true },
      clear: { type: 'string', multiple: true },
    }, ENS_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    const mode = parseMode(values, positionals)
    const { config, identity } = await requireIdentity(deps)
    const registry = resolveRegistryForIdentity(identity, config)
    if (!registry) throw new HistoryError(1, 'No agent registry is configured for this identity.', '`ethagent restore <token-id>` records it.')

    if (mode.kind === 'read') {
      const view = await readView(identity, registry, deps, seams)
      if (json) await emitJson(deps.io, view)
      else await deps.io.out(printView(view))
      return 0
    }

    if (!identity.agentId) throw new HistoryError(1, 'This identity has no agent token ID yet.', 'Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')
    const owner = getAddress(humanOwnerAddress(identity))
    const signer = chooseSigner(deps, Boolean(values.operator), owner)
    const client = seams.readClient()
    const currentName = readIdentityStateString(identity.state as Record<string, unknown> | undefined, 'ensName')

    let transactions: EnsPlannedTransaction[]
    let publishName: string | null = null
    let summary: Record<string, unknown>
    if (mode.kind === 'swap') {
      const plan = await planEnsSwap({
        client,
        newName: mode.name,
        oldName: currentName || null,
        signer: signer.address,
        signerRole: signer.role,
        agentOwner: owner,
        chainId: registry.chainId,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: identity.agentId,
      })
      transactions = plan.transactions
      publishName = plan.newName
      summary = { action: 'swap', name: plan.newName, oldName: plan.oldName, create: plan.create }
    } else if (mode.kind === 'unlink') {
      if (!currentName) throw new HistoryError(1, 'No ENS name is linked, so there is nothing to unlink.')
      const plan = await planEnsUnlink({
        client,
        name: currentName,
        signer: signer.address,
        signerRole: signer.role,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: identity.agentId,
      })
      transactions = plan.transactions
      publishName = ''
      summary = { action: 'unlink', name: plan.name, records: plan.current }
    } else {
      if (!currentName) throw new HistoryError(1, 'No ENS name is linked.', 'Link one first with `ethagent ens <name>`.')
      const plan = await planEnsRecords({
        client,
        name: currentName,
        set: mode.set,
        clear: mode.clear,
        signer: signer.address,
        signerRole: signer.role,
      })
      transactions = plan.transactions
      summary = { action: 'records', name: plan.name, changes: plan.diffs.filter(diff => diff.changed) }
    }

    const publish = publishName === null ? null : { ensName: publishName, signer: 'owner wallet', via: resolveVaultAddress(identity, config.erc8004?.operatorVaults) ? 'vault' : 'registry' }
    if (!values.yes) {
      const simulations = new Map<EnsPlannedTransaction, Parameters<typeof txJson>[1]>()
      let afterPrevious = false
      for (const tx of transactions) {
        if (tx.dependsOnPrevious || afterPrevious) {
          simulations.set(tx, 'after-previous')
          afterPrevious = true
          continue
        }
        simulations.set(tx, await simulatePlannedTransaction(client, signer.address, tx))
      }
      const preview = {
        applied: false,
        ...summary,
        signer: { kind: signer.kind, address: signer.address },
        transactions: transactions.map(tx => txJson(tx, simulations.get(tx))),
        publish,
      }
      if (json) {
        await emitJson(deps.io, preview)
      } else {
        const lines: string[] = []
        if (transactions.length === 0 && !publish) {
          lines.push('Nothing to change: the records already match.')
        } else {
          lines.push(`Preview (nothing sent). Signer: ${signer.role} ${signer.address}.`)
          transactions.forEach((tx, index) => {
            const sim = simulations.get(tx)
            const simText = sim === 'after-previous' ? 'runs after the step before it' : sim && sim.ok ? 'would succeed' : sim ? `refused: ${sim.reason}` : ''
            lines.push(`  ${index + 1}. Ethereum Mainnet tx to ${tx.to}: ${tx.description} [${simText}]`)
          })
          if (publish) {
            lines.push(`  ${transactions.length + 1}. owner-signed save publishing ${publish.ensName ? `ensName ${publish.ensName}` : 'no ENS name'} (${publish.via === 'vault' ? 'through the Vault' : 'on the registry'})`)
          }
          lines.push('Run again with --yes to send.')
        }
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }

    if (transactions.length === 0 && publishName === null) {
      if (json) await emitJson(deps.io, { applied: false, ...summary, reason: 'no-changes' })
      else await deps.io.out('Nothing to change: the records already match.\n')
      return 0
    }

    let saveReady: { jwt: string } | null = null
    if (publishName !== null) {
      const vault = await seams.vaultStatus(identity).catch(() => ({ ready: false }))
      if (!vault.ready) throw new HistoryError(1, 'Local continuity files are not restored.', 'Bring them back with `ethagent restore` before changing its name. Nothing was sent.')
      let jwt: string | undefined
      try {
        jwt = await seams.resolveJwt()
      } catch (err) {
        throw new HistoryError(3, `The configured Pinata JWT is invalid or unreachable (${err instanceof Error ? err.message : String(err)}). Nothing was sent.`)
      }
      if (!jwt) throw new HistoryError(3, 'No IPFS storage credential configured, so the name cannot be published.', 'Save one with `ethagent storage --set` (or export PINATA_JWT), then retry. Nothing was sent.')
      saveReady = { jwt }
      await seams.pullHarness(identity).catch(() => [])
    }

    const noOpen = Boolean(values['no-open'])
    const sink = json ? deps.io.err : deps.io.out
    let session: BrowserWalletSession | null = null
    const ensureSession = async (): Promise<BrowserWalletSession> => {
      if (session) return session
      session = await seams.openSession(ready => {
        void sink(`Approve in your browser wallet tab: ${ready.url}\nThis waits until you approve or cancel.\n`)
        if (!noOpen) seams.openExternal(ready.url)
      })
      return session
    }
    const callbacks: EffectCallbacks = {
      onStep: () => {},
      onWalletReady: () => {},
      onIdentityComplete: async () => {},
    }
    const flowId = mode.kind === 'swap' ? 'ens-link' : mode.kind === 'unlink' ? 'ens-clear' : 'ens-update'
    const sent: Array<{ step: string; name: string; txHash: string }> = []
    let savedIdentity: EthagentIdentity | undefined
    try {
      let ensSigner: EnsSigner
      if (signer.kind === 'operator') {
        ensSigner = operatorEnsSigner(seams.operatorSender(signer.key))
      } else {
        ensSigner = browserEnsSigner({ account: signer.address, callbacks, session: await ensureSession() })
      }
      const publicClient = seams.ensClient()
      for (const tx of transactions) {
        const flowStep = tx.step === 'create-subdomain' ? 1 : mode.kind === 'swap' ? 2 : 1
        await sink(`Sending: ${tx.description}\n`)
        const { txHash } = await sendEnsTransaction({
          signer: ensSigner,
          fullName: tx.name,
          to: tx.to,
          data: tx.data,
          purpose: tx.purpose,
          publicClient,
          callbacks,
          action: `ENS ${tx.step}`,
          tokenChainId: registry.chainId,
          flowId,
          flowStep,
        })
        sent.push({ step: tx.step, name: tx.name, txHash })
        await sink(`Confirmed: ${txHash}\n`)
      }
      if (publishName !== null && saveReady) {
        const vaultAddress = resolveVaultAddress(identity, config.erc8004?.operatorVaults)
        const step: Extract<Step, { kind: 'rebackup-signing' }> = {
          kind: 'rebackup-signing',
          identity,
          registry,
          pinataJwt: saveReady.jwt,
          returnTo: { kind: 'menu' },
          profileUpdates: { ensName: publishName },
          ...(vaultAddress ? { vaultAddress } : {}),
        }
        await sink('Publishing the name change: approve one owner-signed save.\n')
        await seams.publish(step, {
          ...callbacks,
          // Local state takes the new name only once the owner-signed save has landed.
          onIdentityComplete: async nextIdentity => {
            await seams.saveConfig({ ...config, identity: nextIdentity })
            savedIdentity = nextIdentity
          },
        }, await ensureSession(), { flowId, flowStep: mode.kind === 'swap' ? 3 : 2 })
      }
    } catch (err: unknown) {
      if (isWalletCancelled(err)) {
        throw new HistoryError(3, `Wallet approval was cancelled.${sent.length ? ` ${sent.length} ENS transaction(s) already confirmed: ${sent.map(item => item.txHash).join(', ')}.` : ' Nothing was sent.'}`)
      }
      if (err instanceof Error && sent.length > 0) {
        throw new HistoryError(1, `${err.message} (already confirmed: ${sent.map(item => `${item.step} ${item.txHash}`).join(', ')})`)
      }
      throw err
    } finally {
      const open = session as BrowserWalletSession | null
      if (open) await open.close().catch(() => {})
    }

    const result = {
      applied: true,
      ...summary,
      signer: { kind: signer.kind, address: signer.address },
      transactions: sent,
      ...(publishName !== null
        ? { published: Boolean(savedIdentity), cid: savedIdentity?.backup?.cid ?? null, txHash: savedIdentity?.backup?.txHash ?? null }
        : {}),
    }
    if (json) {
      await emitJson(deps.io, result)
    } else {
      const lines = [`Done: ${sent.length} ENS transaction(s) confirmed.`]
      if (publishName !== null) lines.push(savedIdentity ? `Published ${publishName ? `ensName ${publishName}` : 'the unlinked name'}.` : 'The owner-signed save did not complete; local state keeps the old name.')
      await deps.io.out(`${lines.join('\n')}\n`)
    }
    return publishName !== null && !savedIdentity ? 1 : 0
  } catch (err) {
    if (err instanceof EnsPlanRefusal) return failFrom(deps.io, json, new HistoryError(1, err.message, err.hint))
    return failFrom(deps.io, json, err)
  }
}
