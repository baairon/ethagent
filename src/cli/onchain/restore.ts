import { getAddress, isAddress, type Address } from 'viem'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import { DEFAULT_IPFS_API_URL } from '../../identity/storage/ipfs.js'
import {
  AgentTokenIdRequiredError,
  chainIdForNetwork,
  discoverOwnedAgentBackupByTokenId,
  discoverOwnedAgentBackups,
  discoverOwnedAgentBackupsAcrossSupportedNetworks,
  erc8004ConfigForSupportedChain,
  supportedErc8004ChainForId,
  type Erc8004AgentCandidate,
  type Erc8004RegistryConfig,
} from '../../identity/registry/erc8004.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import { parseAgentTokenReference, readEthagentTextRecords } from '../../identity/ens/ensLookup.js'
import { AGENT_TOKEN_RECORD_KEY } from '../../identity/ens/agentRecords.js'
import { envelopeChallengeFor, localKeySigner } from '../../identity/continuity/localKeyDecrypt.js'
import { listPublishedContinuitySnapshots } from '../../identity/continuity/snapshots.js'
import { continuityWorkingTreeStatus } from '../../identity/continuity/storage/status.js'
import { hasPendingPublish } from '../../identity/manager/continuity/state.js'
import { resolveAgentEnsToCandidate, resolveAgentTokenIdToCandidate } from '../../identity/manager/restore/resolve.js'
import { canRestoreCandidate } from '../../identity/manager/restore/discover.js'
import { runRestoreFetch } from '../../identity/manager/restore/fetch.js'
import { runRestoreAuthorize } from '../../identity/manager/restore/apply.js'
import { runRecoveryRefetch } from '../../identity/manager/restore/recovery.js'
import { isContinuitySnapshotEnvelope } from '../../identity/manager/restore/envelopes.js'
import type { RestoreSigner } from '../../identity/manager/restore/signer.js'
import type { Step } from '../../identity/manager/reducer.js'
import { openBrowserWalletSession, type BrowserWalletSession, type BrowserWalletReady } from '../../identity/wallet/browserWallet.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, type HistoryDeps } from '../history/shared.js'
import {
  networkOfChain,
  parseNetwork,
  persistIdentity,
  quietCallbacks,
  registryForNetwork,
  requireOperatorKey,
  walletCancelled,
  WalletTab,
} from './shared.js'

export const RESTORE_USAGE = 'ethagent restore [<token-id> | <name> | --owner <address|name>] [--network mainnet|base] [--operator] [--yes] [--no-open] [--json]'

const HELP = [
  `usage: ${RESTORE_USAGE}`,
  '',
  '  ethagent restore <token-id>      rebuild that agent on this machine (needs --network',
  '                                   unless this machine already has an identity on it)',
  '  ethagent restore <name>          rebuild the agent an ENS name points at',
  '  ethagent restore --owner <address|name>',
  '                                   list the agents that wallet holds or operates. Read-only.',
  '  ethagent restore                 with an identity here: pull the newest onchain snapshot',
  '                                   into the vault (Refetch Latest)',
  '',
  'Previews until --yes. The browser wallet signs the decrypt challenge in one tab, or with',
  '--operator the operator key decrypts locally and nothing opens. Whatever the vault held is',
  'checkpointed first; `ethagent rollback --undo --yes` puts it back. Nothing is sent onchain.',
  '',
].join('\n')

type AuthorizingStep = Extract<Step, { kind: 'restore-authorizing' }>

export type RestoreSeams = {
  resolveTokenId: typeof resolveAgentTokenIdToCandidate
  resolveEns: typeof resolveAgentEnsToCandidate
  ensTokenChain: (name: string) => Promise<number | null>
  discoverOwner: (owner: string, registry?: Erc8004RegistryConfig) => Promise<Erc8004AgentCandidate[]>
  latestCandidate: (identity: EthagentIdentity, registry: Erc8004RegistryConfig) => Promise<Erc8004AgentCandidate>
  fetchEnvelope: (candidate: Erc8004AgentCandidate, requester?: Address) => Promise<AuthorizingStep>
  authorize: typeof runRestoreAuthorize
  refetch: typeof runRecoveryRefetch
  localChanges: (identity: EthagentIdentity) => Promise<boolean>
  openSession: (onReady: (ready: BrowserWalletReady) => void) => Promise<BrowserWalletSession>
  openExternal: (url: string) => void
  saveConfig: (config: EthagentConfig) => Promise<void>
}

const defaultSeams: RestoreSeams = {
  resolveTokenId: resolveAgentTokenIdToCandidate,
  resolveEns: resolveAgentEnsToCandidate,
  ensTokenChain: async name => {
    const records = await readEthagentTextRecords(name, [AGENT_TOKEN_RECORD_KEY])
    const value = records[AGENT_TOKEN_RECORD_KEY]
    return value ? parseAgentTokenReference(value)?.chainId ?? null : null
  },
  discoverOwner: (owner, registry) => registry
    ? discoverOwnedAgentBackups({ ...registry, ownerHandle: owner, ipfsApiUrl: DEFAULT_IPFS_API_URL })
    : discoverOwnedAgentBackupsAcrossSupportedNetworks({ ownerHandle: owner, ipfsApiUrl: DEFAULT_IPFS_API_URL }),
  latestCandidate: (identity, registry) => discoverOwnedAgentBackupByTokenId({
    ...registry,
    ownerHandle: getAddress(identity.ownerAddress ?? identity.address),
    tokenId: BigInt(identity.agentId ?? '0'),
    ipfsApiUrl: identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
  }),
  fetchEnvelope: async (candidate, requester) => {
    let next: AuthorizingStep | undefined
    await runRestoreFetch({
      kind: 'restore-fetching',
      cid: candidate.backup!.cid,
      apiUrl: DEFAULT_IPFS_API_URL,
      candidate,
      ...(requester ? { requesterAddress: requester } : {}),
    }, quietCallbacks({ onStep: step => { if (step.kind === 'restore-authorizing') next = step } }))
    if (!next) throw new Error('The snapshot did not download.')
    return next
  },
  authorize: runRestoreAuthorize,
  refetch: runRecoveryRefetch,
  localChanges: async identity => {
    const [latest] = await listPublishedContinuitySnapshots(identity, 1)
    const tree = await continuityWorkingTreeStatus(identity, latest)
    return tree.ready && tree.localChangedAfterBackup
  },
  openSession: onReady => openBrowserWalletSession({ title: 'ethagent restore', onReady }),
  openExternal: url => openExternalUrl(url),
  saveConfig,
}

function candidateJson(candidate: Erc8004AgentCandidate): Record<string, unknown> {
  return {
    agentId: candidate.agentId.toString(),
    network: networkOfChain(candidate.chainId),
    chainId: candidate.chainId,
    name: candidate.name ?? null,
    owner: candidate.ownerAddress,
    heldBy: candidate.tokenOwnerAddress ?? candidate.ownerAddress,
    snapshot: candidate.backup?.cid ?? null,
    savedAt: candidate.backup?.createdAt ?? null,
    readable: !candidate.metadataError,
    ...(candidate.metadataError ? { problem: candidate.metadataError } : {}),
  }
}

function sameAgent(identity: EthagentIdentity | undefined, candidate: Erc8004AgentCandidate): boolean {
  if (!identity?.agentId) return false
  return identity.agentId === candidate.agentId.toString()
    && identity.chainId === candidate.chainId
    && (identity.identityRegistryAddress ?? '').toLowerCase() === candidate.identityRegistryAddress.toLowerCase()
}

// Which wallet the snapshot will ask, in words, for a preview.
function decryptPlan(step: AuthorizingStep, operator: Address | undefined): { signer: string; opens: boolean | null } {
  if (operator) {
    if (!isContinuitySnapshotEnvelope(step.envelope)) {
      return { signer: `operator key ${operator}`, opens: step.envelope.ownerAddress.toLowerCase() === operator.toLowerCase() }
    }
    return { signer: `operator key ${operator}`, opens: envelopeChallengeFor(step.envelope, operator) !== null }
  }
  return { signer: 'the owner wallet or an approved operator wallet, in the browser', opens: null }
}

async function resolveTarget(
  target: string,
  network: ReturnType<typeof parseNetwork>,
  identity: EthagentIdentity | undefined,
  config: EthagentConfig | null,
  seams: RestoreSeams,
): Promise<Erc8004AgentCandidate> {
  if (/^\d+$/.test(target)) {
    const registry = network
      ? registryForNetwork(network)
      : identity ? resolveRegistryForIdentity(identity, config ?? undefined) : null
    if (!registry) throw new HistoryError(2, `Which network holds token #${target}?`, 'Pass --network mainnet or --network base.')
    const result = await seams.resolveTokenId(target, registry)
    if (!result.ok) throw new HistoryError(1, result.message)
    return result.candidate
  }
  if (/^([a-z0-9-]+\.)+eth$/i.test(target)) {
    const chainId = network ? chainIdForNetwork(network) : await seams.ensTokenChain(target)
    if (!chainId) throw new HistoryError(1, `${target} has no agent token record.`, 'Restore by token id instead: `ethagent restore <token-id> --network <network>`.')
    if (!supportedErc8004ChainForId(chainId)) throw new HistoryError(1, `${target} points at chain ${chainId}, which ethagent does not support.`)
    const registry = network ? registryForNetwork(network) : erc8004ConfigForSupportedChain(chainId)
    const result = await seams.resolveEns(target, registry)
    if (!result.ok) throw new HistoryError(1, result.message)
    return result.candidate
  }
  throw new HistoryError(2, `${target} is neither a token id nor a .eth name.`, `usage: ${RESTORE_USAGE}`)
}

export async function runRestoreCommand(args: string[], deps: HistoryDeps, seams: RestoreSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      owner: { type: 'string' },
      network: { type: 'string' },
      operator: { type: 'boolean' },
      yes: { type: 'boolean' },
      'no-open': { type: 'boolean' },
    }, RESTORE_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length > 1) throw new HistoryError(2, `unexpected argument: ${positionals[1]}`, `usage: ${RESTORE_USAGE}`)
    const network = parseNetwork(values.network)
    const target = positionals[0]
    const config = await deps.loadConfig().catch(() => null)
    const identity = config?.identity

    // Listing what a wallet holds needs no key and no wallet.
    if (typeof values.owner === 'string') {
      if (target) throw new HistoryError(2, 'choose either a target or --owner', `usage: ${RESTORE_USAGE}`)
      const owner = values.owner.trim()
      if (!isAddress(owner) && !/^([a-z0-9-]+\.)+eth$/i.test(owner)) throw new HistoryError(2, '--owner expects an address or a .eth name')
      let candidates: Erc8004AgentCandidate[]
      try {
        candidates = await seams.discoverOwner(owner, network ? registryForNetwork(network) : undefined)
      } catch (err: unknown) {
        if (!(err instanceof AgentTokenIdRequiredError)) throw err
        // Never an empty list: the scan did not finish, so say why and how to get past it.
        throw new HistoryError(
          1,
          `${err.message}${err.detail ? ` ${err.detail}` : ''}`,
          `Point ETHAGENT_RPC_URL at a ${network ?? '<network>'} RPC that serves full log history and pass --network, or restore directly with \`ethagent restore <token-id> --network ${network ?? '<network>'}\`.`,
        )
      }
      const rows = candidates.map(candidateJson)
      if (json) {
        await emitJson(deps.io, { owner, agents: rows })
      } else if (rows.length === 0) {
        await deps.io.out(`No agents found for ${owner}${network ? ` on ${network}` : ''}.\n`)
      } else {
        const lines = rows.map(row => `#${String(row.agentId)} on ${String(row.network)}${row.name ? ` · ${String(row.name)}` : ''}${row.snapshot ? ` · saved ${String(row.savedAt ?? '')}` : ' · no snapshot'}${row.readable ? '' : ' · profile unreadable'}`)
        await deps.io.out(`${lines.join('\n')}\nRestore one with \`ethagent restore <token-id> --network <network>\`.\n`)
      }
      return 0
    }

    const operator = values.operator ? requireOperatorKey(deps, 'restore') : undefined
    const refetch = !target
    if (refetch && !identity?.agentId) {
      throw new HistoryError(2, 'No agent identity on this machine yet.', `Pass <token-id> with --network, an agent's <name>, or --owner <address|name> to list agents. usage: ${RESTORE_USAGE}`)
    }

    let candidate: Erc8004AgentCandidate
    let registry: Erc8004RegistryConfig | null = null
    if (refetch) {
      registry = resolveRegistryForIdentity(identity!, config ?? undefined)
      if (!registry) throw new HistoryError(1, 'No agent registry is configured for this identity.')
      candidate = await seams.latestCandidate(identity!, registry)
    } else {
      candidate = await resolveTarget(target, network, identity, config, seams)
    }
    if (!candidate.backup?.cid) {
      throw new HistoryError(1, `Agent #${candidate.agentId.toString()} has no encrypted snapshot to restore.`, candidate.metadataError ? `Its profile did not load: ${candidate.metadataError}` : undefined)
    }
    if (operator && !canRestoreCandidate(candidate, operator.address)) {
      throw new HistoryError(1, `The operator key ${operator.address} is neither the owner of agent #${candidate.agentId.toString()} nor one of its approved operators.`)
    }

    const authorizing = await seams.fetchEnvelope(candidate, operator?.address)
    const plan = decryptPlan(authorizing, operator?.address)
    if (plan.opens === false) {
      throw new HistoryError(3, `The operator key ${operator!.address} has no restore slot in this snapshot.`, 'Save once with the owner wallet after approving this operator, then retry. Nothing was written.')
    }
    const replacing = identity && !sameAgent(identity, candidate)
    const warnings: string[] = []
    if (identity && sameAgent(identity, candidate) && await seams.localChanges(identity).catch(() => false)) {
      warnings.push('the vault has local changes that are not in any saved snapshot; they are checkpointed first')
    }
    if (identity && sameAgent(identity, candidate) && hasPendingPublish(identity)) {
      warnings.push('a pinned snapshot is waiting for the owner to publish it')
    }
    if (replacing) {
      warnings.push(`this machine's identity switches from agent #${identity!.agentId ?? '?'} to #${candidate.agentId.toString()}; the old vault stays on disk`)
    }
    const summary = {
      action: refetch ? 'refetch' : 'restore',
      agent: candidateJson(candidate),
      snapshot: { cid: candidate.backup.cid, createdAt: authorizing.envelope.createdAt },
      signer: operator ? { kind: 'operator', address: operator.address } : { kind: 'browser' },
      decryptsWith: plan.signer,
      warnings,
    }

    if (!values.yes) {
      if (json) {
        await emitJson(deps.io, { applied: false, ...summary })
      } else {
        const lines = [
          `Preview (nothing written). ${refetch ? 'Pull the newest onchain snapshot of' : 'Restore'} agent #${candidate.agentId.toString()} on ${networkOfChain(candidate.chainId)}${candidate.name ? ` (${candidate.name})` : ''}.`,
          `  snapshot ${candidate.backup.cid}, saved ${authorizing.envelope.createdAt}`,
          `  decrypts with ${plan.signer}`,
          ...warnings.map(warning => `  note: ${warning}`),
          'Run again with --yes to restore. The vault is checkpointed first.',
        ]
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }

    const tab = new WalletTab(seams.openSession, deps.io, json, Boolean(values['no-open']), seams.openExternal)
    let restored: EthagentIdentity | undefined
    const signer: RestoreSigner = operator
      ? { kind: 'local', signer: localKeySigner(operator.key) }
      : { kind: 'browser', requestSignature: async req => (await tab.get()).requestSignature(req) }
    const callbacks = quietCallbacks({
      onIdentityComplete: async next => {
        await persistIdentity(next, { loadConfig: deps.loadConfig, saveConfig: seams.saveConfig })
        restored = next
      },
    })
    try {
      if (refetch) {
        await seams.refetch(identity!, registry!, callbacks, { signer })
      } else {
        await seams.authorize(authorizing, callbacks, { signer })
      }
    } catch (err: unknown) {
      const cancelled = walletCancelled(err, [])
      if (cancelled) throw cancelled
      throw err
    } finally {
      await tab.close()
    }
    if (!restored) throw new HistoryError(1, 'The restore did not complete; nothing was saved to config.')
    // Only a vault that already held this agent was checkpointed, so only then is
    // there anything to undo.
    const undo = identity && sameAgent(identity, candidate) ? 'ethagent rollback --undo --yes' : null
    const result = { applied: true, ...summary, snapshotRestored: restored.backup?.cid ?? null, undo }
    if (json) {
      await emitJson(deps.io, result)
    } else {
      await deps.io.out(`Restored agent #${candidate.agentId.toString()} from ${candidate.backup.cid}.\n${undo ? `The previous vault was checkpointed; \`${undo}\` puts it back.\n` : ''}`)
    }
    return 0
  } catch (err) {
    if (err instanceof Error && err.name === 'RestoreLockedError') return failFrom(deps.io, json, new HistoryError(3, err.message))
    return failFrom(deps.io, json, err)
  }
}
