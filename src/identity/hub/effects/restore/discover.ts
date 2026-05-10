import type { EthagentConfig } from '../../../../storage/config.js'
import {
  DEFAULT_IPFS_API_URL,
} from '../../../storage/ipfs.js'
import {
  discoverOwnedAgentBackups,
  type Erc8004AgentCandidate,
  type Erc8004RegistryConfig,
} from '../../../registry/erc8004.js'
import type { RestorePurpose, Step } from '../../identityHubReducer.js'
import type { EffectCallbacks } from '../types.js'
import { isAbortError, isAuthorizedOperatorAddress, requesterAddressFromHandle } from './shared.js'
import type { Address } from 'viem'

export async function runRestoreDiscover(
  step: Extract<Step, { kind: 'restore-discovering' }>,
  _config: EthagentConfig | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const signal = step.abortSignal
  let owned: Erc8004AgentCandidate[]
  try {
    owned = await discoverOwnedAgentBackups({
      ...step.registry,
      ownerHandle: step.ownerHandle,
      ipfsApiUrl: DEFAULT_IPFS_API_URL,
      ...(signal ? { signal } : {}),
    })
  } catch (err: unknown) {
    if (signal?.aborted || isAbortError(err)) return
    callbacks.onStep({
      kind: 'restore-not-found',
      ownerHandle: step.ownerHandle,
      registry: step.registry,
      requesterAddress: requesterAddressFromHandle(step.ownerHandle),
      reason: 'search-incomplete',
      purpose: step.purpose,
    })
    return
  }
  if (signal?.aborted) return
  if (owned.length === 0) {
    callbacks.onStep({
      kind: 'restore-recovery-input',
      ownerHandle: step.ownerHandle,
      registry: step.registry,
      purpose: step.purpose,
    })
    return
  }
  callbacks.onStep(restoreTokenSelectionStep({
    ownerHandle: step.ownerHandle,
    registry: step.registry,
    candidates: owned,
    requesterAddress: requesterAddressFromHandle(step.ownerHandle),
    purpose: step.purpose,
  }))
}

export function restoreTokenSelectionStep(args: {
  ownerHandle: string
  registry: Erc8004RegistryConfig
  candidates: Erc8004AgentCandidate[]
  requesterAddress?: Address
  purpose?: RestorePurpose
}): Extract<Step, { kind: 'restore-select-token' }> {
  const restorable = args.candidates.filter(candidate => candidate.backup?.cid)
  if (restorable.length === 0) {
    throw new Error(args.candidates.length === 0
      ? 'No agent identities found for that wallet on this network'
      : 'No matching agent identity has recoverable ethagent state on this network')
  }
  return {
    kind: 'restore-select-token',
    ownerHandle: args.ownerHandle,
    registry: args.registry,
    candidates: restorable,
    requesterAddress: args.requesterAddress,
    purpose: args.purpose,
  }
}

export function canRestoreCandidate(candidate: Erc8004AgentCandidate, address: Address): boolean {
  if (candidate.ownerAddress.toLowerCase() === address.toLowerCase()) return true
  return isAuthorizedOperatorAddress(candidate, address)
}
