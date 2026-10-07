import { getAddress } from 'viem'
import type { EthagentIdentity } from '../storage/config.js'
import type { continuityWorkingTreeStatus } from '../identity/continuity/storage/status.js'
import type { listPublishedContinuitySnapshots } from '../identity/continuity/snapshots.js'
import type { discoverOwnedAgentBackupByTokenId } from '../identity/registry/erc8004/discovery.js'
import type { Erc8004RegistryConfig } from '../identity/registry/erc8004.js'
import { DEFAULT_IPFS_API_URL } from '../identity/storage/ipfs.js'
import { hasPendingPublish } from '../identity/manager/continuity/state.js'

// Shared by `save` and `save --operator`: the no-changes check that keeps a save from
// pinning and sending when nothing changed, the read-back of the onchain pointer, and
// the JSON envelope.

export type SaveJsonValue = Record<string, unknown>

export function saveJson(value: SaveJsonValue): string {
  return `${JSON.stringify({ schema: 1, ...value })}\n`
}

// True only when the vault matches the latest published snapshot and nothing pinned is
// waiting to publish. An unreadable state is never "nothing to save".
export async function nothingToSave(
  identity: EthagentIdentity,
  deps: {
    listPublishedContinuitySnapshots: typeof listPublishedContinuitySnapshots
    continuityWorkingTreeStatus: typeof continuityWorkingTreeStatus
  },
): Promise<boolean> {
  try {
    const [latest] = await deps.listPublishedContinuitySnapshots(identity, 1)
    const tree = await deps.continuityWorkingTreeStatus(identity, latest)
    return tree.publishState === 'published' && !hasPendingPublish(identity)
  } catch {
    return false
  }
}

export type Verification = 'verified' | 'mismatch' | 'unknown'

// Reads the token back from the registry and compares its snapshot CID with the one
// just published.
export async function verifyPublished(args: {
  saved: EthagentIdentity
  agentId: string
  registry: Erc8004RegistryConfig
  discover: typeof discoverOwnedAgentBackupByTokenId
}): Promise<Verification> {
  const cid = args.saved.backup?.cid ?? null
  try {
    const candidate = await args.discover({
      ...args.registry,
      ownerHandle: getAddress(args.saved.ownerAddress ?? args.saved.address),
      tokenId: BigInt(args.agentId),
      ipfsApiUrl: args.saved.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
    })
    const onchainCid = candidate.backup?.cid ?? null
    return onchainCid ? (onchainCid === cid ? 'verified' : 'mismatch') : 'unknown'
  } catch {
    return 'unknown'
  }
}
