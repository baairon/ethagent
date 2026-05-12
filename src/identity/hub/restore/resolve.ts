import { type Address } from 'viem'
import { DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  discoverOwnedAgentBackupByTokenId,
  type Erc8004AgentCandidate,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { parseAgentTokenReference, readEthagentTextRecords } from '../../ens/ensLookup.js'
import { AGENT_RECORD_KEYS } from '../../ens/agentRecords.js'

const ETH_NAME_PATTERN = /^([a-z0-9-]+\.)+eth$/i

type AgentEnsResolution =
  | { ok: true; candidate: Erc8004AgentCandidate }
  | { ok: false; message: string }

export async function resolveAgentEnsToCandidate(
  ensName: string,
  registry: Erc8004RegistryConfig,
): Promise<AgentEnsResolution> {
  const trimmed = ensName.trim()
  if (!trimmed) return { ok: false, message: 'Enter an agent ENS name (e.g. agent.example.eth).' }
  if (!ETH_NAME_PATTERN.test(trimmed)) return { ok: false, message: 'Enter a valid .eth name.' }
  let records: Record<string, string>
  try {
    records = await readEthagentTextRecords(trimmed, [AGENT_RECORD_KEYS.token])
  } catch (err: unknown) {
    return { ok: false, message: `Could not reach Ethereum mainnet to resolve ${trimmed}: ${err instanceof Error ? err.message : String(err)}` }
  }
  const tokenValue = records[AGENT_RECORD_KEYS.token]
  if (!tokenValue) return { ok: false, message: `${trimmed} has no org.ethagent.token record. Use the full agent subdomain (e.g. agent.${trimmed}).` }
  const tokenRef = parseAgentTokenReference(tokenValue)
  if (!tokenRef) return { ok: false, message: `${trimmed}'s org.ethagent.token record is not a valid eip155 reference.` }
  if (tokenRef.chainId !== registry.chainId) {
    return { ok: false, message: `${trimmed}'s agent token is onchain ${tokenRef.chainId}, not the network you selected.` }
  }
  const finalRegistry: Erc8004RegistryConfig = registry.identityRegistryAddress.toLowerCase() === tokenRef.identityRegistryAddress.toLowerCase()
    ? registry
    : { ...registry, identityRegistryAddress: tokenRef.identityRegistryAddress }
  let owner: Address
  try {
    const publicClient = createErc8004PublicClient(finalRegistry)
    owner = await publicClient.readContract({
      address: finalRegistry.identityRegistryAddress,
      abi: [{ inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'ownerOf', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }] as const,
      functionName: 'ownerOf',
      args: [tokenRef.agentId],
    }) as Address
  } catch (err: unknown) {
    return { ok: false, message: `Could not read ownerOf(token #${tokenRef.agentId.toString()}): ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    const candidate = await discoverOwnedAgentBackupByTokenId({
      ...finalRegistry,
      ownerHandle: owner,
      ipfsApiUrl: DEFAULT_IPFS_API_URL,
      tokenId: tokenRef.agentId,
    })
    return { ok: true, candidate }
  } catch (err: unknown) {
    return { ok: false, message: `Could not load agent token #${tokenRef.agentId.toString()}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function resolveAgentTokenIdToCandidate(
  rawTokenId: string,
  registry: Erc8004RegistryConfig,
): Promise<AgentEnsResolution> {
  const trimmed = rawTokenId.trim()
  if (!trimmed) return { ok: false, message: 'Enter the agent token ID (e.g. 45744).' }
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: 'Token ID must be a positive integer (e.g. 45744).' }
  let tokenId: bigint
  try {
    tokenId = BigInt(trimmed)
  } catch {
    return { ok: false, message: 'Token ID must be a positive integer (e.g. 45744).' }
  }
  let owner: Address
  try {
    const publicClient = createErc8004PublicClient(registry)
    owner = await publicClient.readContract({
      address: registry.identityRegistryAddress,
      abi: [{ inputs: [{ name: 'tokenId', type: 'uint256' }], name: 'ownerOf', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' }] as const,
      functionName: 'ownerOf',
      args: [tokenId],
    }) as Address
  } catch (err: unknown) {
    return { ok: false, message: `Token #${trimmed} not found on this network: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    const candidate = await discoverOwnedAgentBackupByTokenId({
      ...registry,
      ownerHandle: owner,
      ipfsApiUrl: DEFAULT_IPFS_API_URL,
      tokenId,
    })
    return { ok: true, candidate }
  } catch (err: unknown) {
    return { ok: false, message: `Could not load agent token #${trimmed}: ${err instanceof Error ? err.message : String(err)}` }
  }
}
