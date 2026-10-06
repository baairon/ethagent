import { getAddress, type Address } from 'viem'
import type { EthagentConfig } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import { continuityVaultStatus } from '../../identity/continuity/storage/status.js'
import { resolveValidatedPinataJwt } from '../../identity/storage/pinataJwt.js'
import { assertTokenNotInVault, TokenInVaultError } from '../../identity/manager/custody/preflight.js'
import { resolveTransferTargetAddress, runTokenTransferSigning } from '../../identity/manager/transfer/effects.js'
import { humanOwnerAddress } from '../../identity/manager/custody/helpers.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import { pullHarnessSoulMemoryIntoVault } from '../sync.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from '../history/shared.js'
import { quietCallbacks, requireStorage, walletCancelled } from './shared.js'

export const TRANSFER_USAGE = 'ethagent transfer <address|name> [--yes] [--no-open] [--json]'

const HELP = [
  `usage: ${TRANSFER_USAGE}`,
  '',
  'Prepares the agent for a new owner: the current owner and the receiver both sign in one',
  'browser tab, which re-encrypts soul, memory, and skills for the receiver, then the owner',
  'publishes that snapshot. Both wallets must be available in this browser. Previews until --yes.',
  '',
  'ethagent never moves the token itself. After this, send the token to the receiver from your',
  'wallet; the receiver then runs `ethagent restore <token-id>` on their machine.',
  'A token held in a Vault must come out first: `ethagent custody --simple`.',
  '',
].join('\n')

export type TransferSeams = {
  resolveTarget: (handle: string) => Promise<Address>
  assertNotInVault: typeof assertTokenNotInVault
  sign: typeof runTokenTransferSigning
  resolveJwt: typeof resolveValidatedPinataJwt
  vaultStatus: typeof continuityVaultStatus
  pullHarness: typeof pullHarnessSoulMemoryIntoVault
  openExternal: (url: string) => void
  saveConfig: (config: EthagentConfig) => Promise<void>
}

const defaultSeams: TransferSeams = {
  resolveTarget: handle => resolveTransferTargetAddress(handle),
  assertNotInVault: assertTokenNotInVault,
  sign: runTokenTransferSigning,
  resolveJwt: resolveValidatedPinataJwt,
  vaultStatus: continuityVaultStatus,
  pullHarness: pullHarnessSoulMemoryIntoVault,
  openExternal: url => openExternalUrl(url),
  saveConfig,
}

export async function runTransferCommand(args: string[], deps: HistoryDeps, seams: TransferSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      yes: { type: 'boolean' },
      'no-open': { type: 'boolean' },
    }, TRANSFER_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length !== 1) throw new HistoryError(2, positionals.length ? `unexpected argument: ${positionals[1]}` : 'Who receives the agent?', `usage: ${TRANSFER_USAGE}`)
    const handle = positionals[0]!.trim()
    const { config, identity } = await requireIdentity(deps)
    if (!identity.agentId) throw new HistoryError(1, 'This identity has no agent token ID yet.')
    const registry = resolveRegistryForIdentity(identity, config)
    if (!registry) throw new HistoryError(1, 'No agent registry is configured for this identity.')
    const owner = getAddress(humanOwnerAddress(identity))
    let target: Address
    try {
      target = await seams.resolveTarget(handle)
    } catch (err: unknown) {
      throw new HistoryError(1, err instanceof Error ? err.message : String(err))
    }
    if (target.toLowerCase() === owner.toLowerCase()) throw new HistoryError(1, 'The receiver must be a different wallet from the owner.')
    try {
      await seams.assertNotInVault({ identity, registry, operatorVaults: config.erc8004?.operatorVaults })
    } catch (err: unknown) {
      if (err instanceof TokenInVaultError) {
        throw new HistoryError(1, err.message, 'Withdraw it first with `ethagent custody --simple`, then retry. Nothing was signed.')
      }
      throw err
    }
    const summary = {
      action: 'transfer',
      agentId: identity.agentId,
      owner,
      receiver: target,
      ...(handle.toLowerCase() !== target.toLowerCase() ? { receiverName: handle } : {}),
      steps: [
        { step: 'sender-sign', signer: `owner wallet ${owner}`, description: 'sign the transfer snapshot as the sender' },
        { step: 'receiver-sign', signer: `receiver wallet ${target}`, description: 'sign as the receiver, in the same browser' },
        { step: 'publish', signer: `owner wallet ${owner}`, description: 'publish the snapshot the receiver can open' },
      ],
      afterwards: `send token #${identity.agentId} to ${target} from your wallet; ethagent does not move it`,
    }
    if (!values.yes) {
      if (json) {
        await emitJson(deps.io, { applied: false, ...summary })
      } else {
        const lines = [`Preview (nothing signed or sent). Prepare agent #${identity.agentId} for ${handle}${handle.toLowerCase() !== target.toLowerCase() ? ` (${target})` : ''}.`]
        summary.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step.description} [${step.signer}]`))
        lines.push(`Afterwards: ${summary.afterwards}.`)
        lines.push('Run again with --yes. Both wallets must be available in this browser.')
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }

    const vault = await seams.vaultStatus(identity).catch(() => ({ ready: false }))
    if (!vault.ready) throw new HistoryError(1, 'Local continuity files are not restored.', 'Run `ethagent restore` first. Nothing was signed.')
    const jwt = await requireStorage(seams.resolveJwt)
    await seams.pullHarness(identity).catch(() => [])
    const noOpen = Boolean(values['no-open'])
    let result
    try {
      result = await seams.sign({
        kind: 'token-transfer-signing',
        identity,
        registry,
        targetHandle: handle,
        targetAddress: target,
        pinataJwt: jwt,
        returnTo: { kind: 'menu' },
      }, quietCallbacks({
        onWalletReady: ready => {
          if (!ready) return
          const sink = json ? deps.io.err : deps.io.out
          void sink(`Approve in your browser wallet tab: ${ready.url}\nSign with the owner wallet, switch to the receiver wallet when asked, then approve the publish with the owner.\n`)
          if (!noOpen) seams.openExternal(ready.url)
        },
      }))
    } catch (err: unknown) {
      const cancelled = walletCancelled(err, [])
      if (cancelled) throw cancelled
      throw err
    }
    await seams.saveConfig({ ...config, identity: result.identity })
    const output = { applied: true, ...summary, snapshot: result.snapshotCid, txHash: result.txHash }
    if (json) await emitJson(deps.io, output)
    else await deps.io.out(`Transfer snapshot published (${result.txHash}).\nNow ${summary.afterwards}.\n`)
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
