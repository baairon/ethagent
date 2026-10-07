import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { runReconciliation } from '../../identity/manager/shared/reconciliation/agentReconciliation/run.js'
import type { AgentReconciliation } from '../../identity/manager/shared/reconciliation/agentReconciliation/types.js'
import { readCustodyMode, readIdentityStateString } from '../../identity/manager/custody/state.js'
import { changedContinuitySnapshotFiles, hasPendingPublish } from '../../identity/manager/continuity/state.js'
import { transferSnapshotView } from '../../identity/manager/transfer/state.js'
import { listPublishedContinuitySnapshots } from '../../identity/continuity/snapshots.js'
import { continuityWorkingTreeStatus } from '../../identity/continuity/storage/status.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from '../history/shared.js'
import { networkOfChain } from './shared.js'

export const CHECK_USAGE = 'ethagent check [--json]'

const HELP = [
  `usage: ${CHECK_USAGE}`,
  '',
  'Every value that identifies this agent, read against the chain, and anything that needs',
  'attention with the command that fixes it. Read-only: nothing is signed or sent.',
  '',
  'Exits 0 when nothing needs attention and 4 when something does.',
  '',
].join('\n')

export type CheckSeams = {
  reconcile: (identity: EthagentIdentity, config: EthagentConfig) => Promise<AgentReconciliation>
  localChanges: (identity: EthagentIdentity) => Promise<string[] | null>
}

async function localChangedFiles(identity: EthagentIdentity): Promise<string[] | null> {
  try {
    const [latest] = await listPublishedContinuitySnapshots(identity, 1)
    const status = await continuityWorkingTreeStatus(identity, latest)
    if (!status.ready) return null
    return status.publishState === 'local-changes' ? changedContinuitySnapshotFiles(status) : []
  } catch {
    return null
  }
}

export const defaultSeams: CheckSeams = {
  reconcile: runReconciliation,
  localChanges: localChangedFiles,
}

type Attention = { code: string; message: string; fix?: string }

// The manager's Token Values, as data: null where a value is not set yet.
export function tokenValues(identity: EthagentIdentity): Record<string, unknown> {
  const state = identity.state
  const custody = readCustodyMode(state)
  const transfer = transferSnapshotView(identity)
  const owner = readIdentityStateString(state, 'ownerAddress') || identity.ownerAddress || identity.address
  return {
    agentId: identity.agentId ?? null,
    network: identity.chainId ? networkOfChain(identity.chainId) : null,
    chainId: identity.chainId ?? null,
    registry: identity.identityRegistryAddress ?? null,
    owner,
    agentUri: identity.agentUri ?? (identity.metadataCid ? `ipfs://${identity.metadataCid}` : null),
    metadataCid: identity.metadataCid ?? null,
    snapshotCid: identity.backup?.cid ?? null,
    agentCardCid: identity.agentCard?.cid ?? null,
    ensName: readIdentityStateString(state, 'ensName') || null,
    custody: custody ?? null,
    vault: custody === 'advanced' ? readIdentityStateString(state, 'operatorVaultAddress') || null : null,
    activeOperator: readIdentityStateString(state, 'activeOperatorAddress') || null,
    lastSaved: identity.backup?.createdAt ?? null,
    pendingPublish: hasPendingPublish(identity),
    transfer: transfer
      ? {
          state: transfer.kind,
          receiver: transfer.receiver,
          ...(transfer.receiverHandle && transfer.receiverHandle !== transfer.receiver ? { receiverName: transfer.receiverHandle } : {}),
        }
      : null,
    pendingTx: identity.pendingTx ?? null,
  }
}

// The manager's Needs Attention, each with the headless command that settles it.
export function attentionItems(identity: EthagentIdentity, recon: AgentReconciliation, changed: string[] | null): Attention[] {
  const items: Attention[] = []
  const pending = hasPendingPublish(identity)
  if (recon.rpc === 'failing') {
    items.push({ code: 'chain-unreachable', message: 'The chain could not be read, so only local values are shown.', fix: 'Retry later, or point ETHAGENT_RPC_URL at another RPC endpoint for this chain.' })
  }
  if (recon.token === 'unlinked') {
    const label = recon.tokenAgentId ? `Token #${recon.tokenAgentId}` : 'The token'
    items.push(transferSnapshotView(identity)
      ? { code: 'token-transferred', message: `${label} was transferred. Soul, memory, and skills stay on this machine.` }
      : {
          code: 'token-unlinked',
          message: `${label} left this wallet without a prepared transfer${recon.onChainOwner ? `; it is now held by ${recon.onChainOwner}` : ''}.`,
          fix: 'ethagent restore --owner <address>',
        })
  }
  if (recon.custody === 'mid-flow-uri-pending') {
    items.push({ code: 'custody-unfinished', message: 'Advanced custody setup is unfinished.', fix: 'ethagent custody --advanced' })
  } else if (recon.agentUri === 'local-newer' || recon.agentUri === 'chain-newer') {
    items.push(pending
      ? { code: 'publish-pending', message: 'Your newest snapshot is pinned but not onchain yet.', fix: 'ethagent save' }
      : { code: 'agent-uri-differs', message: 'The onchain agent URI differs from this machine\'s. Another machine may have saved since.', fix: 'ethagent restore' })
  } else if (pending) {
    items.push({ code: 'publish-pending', message: 'Your newest snapshot is pinned but not onchain yet.', fix: 'ethagent save' })
  }
  if (recon.vault === 'missing') items.push({ code: 'vault-missing', message: 'The Vault contract was not found.', fix: 'ethagent custody --verify' })
  if (recon.vault === 'unrecognized') items.push({ code: 'vault-unrecognized', message: 'The Vault address holds code that is not a known Vault build.', fix: 'ethagent custody --verify' })
  if (changed && changed.length > 0) {
    items.push({ code: 'local-changes', message: `Local changes since the last snapshot: ${changed.join(', ')}.`, fix: 'ethagent save' })
  }
  if (identity.pendingTx) {
    items.push({
      code: 'transaction-unconfirmed',
      message: `A ${identity.pendingTx.kind} transaction sent ${identity.pendingTx.submittedAt} was not seen to confirm: ${identity.pendingTx.hash}.`,
      fix: 'Look it up on the block explorer; running the same command again resumes from chain state.',
    })
  }
  return items
}

export async function runCheckCommand(args: string[], deps: HistoryDeps, seams: CheckSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {}, CHECK_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length > 0) throw new HistoryError(2, `unexpected argument: ${positionals[0]}`, `usage: ${CHECK_USAGE}`)
    const { config, identity } = await requireIdentity(deps)
    if (!identity.agentId || !identity.chainId || !identity.identityRegistryAddress) {
      throw new HistoryError(1, 'This identity has no agent token yet.', 'Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')
    }
    // ETHAGENT_RPC_URL replaces the saved RPC for this read, so a failing endpoint can be routed around.
    const rpcOverride = deps.env.ETHAGENT_RPC_URL?.trim()
    const probed = rpcOverride ? { ...identity, rpcUrl: rpcOverride } : identity
    const [recon, changed] = await Promise.all([seams.reconcile(probed, config), seams.localChanges(identity)])
    const valuesView = tokenValues(identity)
    const attention = attentionItems(identity, recon, changed)
    const chain = {
      reachable: recon.rpc === 'reachable',
      token: recon.token,
      onchainOwner: recon.onChainOwner ?? null,
      custody: recon.custody,
      agentUri: recon.agentUri,
      vault: recon.vault,
      vaultBuild: recon.vaultBuild?.label ?? null,
    }
    if (json) {
      await emitJson(deps.io, { values: valuesView, chain, attention })
    } else {
      const out: string[] = []
      const rows: Array<[string, unknown]> = [
        ['agent', valuesView.agentId ? `#${valuesView.agentId}` : null],
        ['network', valuesView.network],
        ['registry', valuesView.registry],
        ['owner', valuesView.owner],
        ['onchain owner', chain.onchainOwner && String(chain.onchainOwner).toLowerCase() !== String(valuesView.owner).toLowerCase() ? chain.onchainOwner : null],
        ['agent URI', valuesView.agentUri],
        ['snapshot CID', valuesView.snapshotCid],
        ['metadata CID', valuesView.metadataCid],
        ['agent card CID', valuesView.agentCardCid],
        ['ENS name', valuesView.ensName],
        ['custody', valuesView.custody],
        ['vault', valuesView.vault ? `${valuesView.vault}${chain.vaultBuild ? ` (${chain.vaultBuild})` : ''}` : null],
        ['operator', valuesView.activeOperator],
        ['last saved', valuesView.lastSaved ?? 'never'],
      ]
      const transfer = valuesView.transfer as { state: string; receiver: string; receiverName?: string } | null
      if (transfer) rows.push(['transfer', `${transfer.state === 'ready-to-transfer' ? 'snapshot ready for' : 'snapshot received for'} ${transfer.receiver}${transfer.receiverName ? ` (${transfer.receiverName})` : ''}`])
      const width = Math.max(...rows.map(([label]) => label.length))
      for (const [label, value] of rows) {
        if (value === null || value === undefined || value === '') continue
        out.push(`${label.padEnd(width)}  ${String(value)}`)
      }
      out.push('')
      if (attention.length === 0) {
        out.push('Nothing needs attention.')
      } else {
        out.push('Needs attention:')
        for (const item of attention) out.push(`  ${item.message}${item.fix ? `\n    fix: ${item.fix}` : ''}`)
      }
      await deps.io.out(`${out.join('\n')}\n`)
    }
    return attention.length > 0 ? 4 : 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
