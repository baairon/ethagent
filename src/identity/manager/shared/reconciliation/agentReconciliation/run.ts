import { getAddress, type Address, type PublicClient } from 'viem'
import {
  createErc8004PublicClient,
  erc8004ConfigForSupportedChain,
  validateErc8004TokenOwner,
  type Erc8004RegistryConfig,
} from '../../../../registry/erc8004.js'
import { isAgentInVault, resolveConfiguredVaultAddress } from '../../../../registry/vault.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../../storage/config.js'
import { readVaultAddressField } from '../../../../identityCompat.js'
import { readCustodyMode } from '../../../custody/state.js'
import { continuityWorkingTreeStatus, type ContinuityWorkingTreeStatus } from '../../../../continuity/storage.js'
import { listPublishedContinuitySnapshots } from '../../../../continuity/snapshots.js'
import type { AgentReconciliation } from './types.js'

export function emptyReconciliation(): AgentReconciliation {
  return {
    token: 'no-agent',
    custody: 'unknown',
    agentUri: 'unknown',
    vault: 'unset',
    workingTree: 'unknown',
    rpc: 'reachable',
    driftCount: 0,
    lastCheckedAt: new Date().toISOString(),
  }
}

export async function runReconciliation(
  identity: EthagentIdentity,
  config: EthagentConfig,
): Promise<AgentReconciliation> {
  const fallback = (() => {
    try { return erc8004ConfigForSupportedChain(identity.chainId!) }
    catch { return null }
  })()
  const rpcUrl = identity.rpcUrl ?? config.erc8004?.rpcUrl ?? fallback?.rpcUrl ?? ''
  const registry: Erc8004RegistryConfig = {
    chainId: identity.chainId!,
    rpcUrl,
    identityRegistryAddress: identity.identityRegistryAddress! as `0x${string}`,
  }
  const expectedOwner = getAddress(identity.ownerAddress ?? identity.address) as Address
  const agentId = BigInt(identity.agentId!)
  const operatorVaults = config.erc8004?.operatorVaults
  const vaultAddress = resolveReconciliationVaultAddress(identity, operatorVaults)

  if (!rpcUrl) {
    return {
      token: 'unknown',
      tokenDetail: `no rpcUrl configured for chain ${identity.chainId}`,
      custody: 'unknown',
      agentUri: 'unknown',
      vault: vaultAddress ? 'unknown' : 'unset',
      workingTree: 'unknown',
      rpc: 'failing',
      driftCount: 0,
      lastCheckedAt: new Date().toISOString(),
    }
  }

  const client = createErc8004PublicClient(registry)

  const [
    tokenResult,
    custodyResult,
    agentUriResult,
    vaultResult,
    workingTreeResult,
  ] = await Promise.allSettled([
    probeToken({ registry, agentId, expectedOwner, operatorVaults }),
    probeCustody({ client, registry, agentId, expectedOwner, vaultAddress, identity }),
    probeAgentUri({ client, registry, agentId, identity }),
    probeVault({ client, vaultAddress }),
    probeWorkingTree(identity),
  ])

  const token = unwrap(tokenResult, fallbackToken)
  const custody = unwrap(custodyResult, () => ({ kind: 'unknown' as const }))
  const agentUri = unwrap(agentUriResult, () => ({ kind: 'unknown' as const }))
  const vault = unwrap(vaultResult, () => ({ kind: vaultAddress ? 'unknown' as const : 'unset' as const }))
  const workingTree = unwrap(workingTreeResult, () => ({ kind: 'unknown' as const }))

  const allFailed = [tokenResult, custodyResult, agentUriResult, vaultResult]
    .every(r => r.status === 'rejected')
  const rpc: 'reachable' | 'failing' = allFailed ? 'failing' : 'reachable'

  const recon: AgentReconciliation = {
    token: token.kind,
    ...(token.kind === 'unlinked' && token.detail ? { tokenDetail: token.detail } : {}),
    ...(token.kind === 'unlinked' ? { tokenAgentId: token.agentId } : {}),
    ...(token.kind === 'linked' ? { onChainOwner: token.onChainOwner } : {}),
    ...(token.kind === 'unlinked' && token.onChainOwner ? { onChainOwner: token.onChainOwner } : {}),
    ...(token.kind === 'unknown' && token.detail ? { tokenDetail: token.detail } : {}),
    custody: custody.kind,
    agentUri: agentUri.kind,
    vault: vault.kind,
    workingTree: workingTree.kind,
    rpc,
    driftCount: 0,
    lastCheckedAt: new Date().toISOString(),
  }
  recon.driftCount = computeDriftCount(recon)
  return recon
}

function resolveReconciliationVaultAddress(
  identity: EthagentIdentity,
  operatorVaults?: Readonly<Record<string, string>>,
): Address | undefined {
  const identityVault = readVaultAddressField(identity.state as Record<string, unknown> | undefined)
  if (identityVault) return getAddress(identityVault)
  if (readCustodyMode(identity.state as Record<string, unknown> | undefined) !== 'advanced') return undefined
  if (!identity.chainId) return undefined
  return resolveConfiguredVaultAddress(operatorVaults, identity.chainId)
}

type TokenProbe =
  | { kind: 'linked'; onChainOwner: string }
  | { kind: 'unlinked'; detail: string; agentId: string; onChainOwner?: string }
  | { kind: 'unknown'; detail: string }
  | { kind: 'no-agent' }

async function probeToken(args: {
  registry: Erc8004RegistryConfig
  agentId: bigint
  expectedOwner: Address
  operatorVaults?: Readonly<Record<string, string>>
}): Promise<TokenProbe> {
  const result = await validateErc8004TokenOwner({
    ...args.registry,
    agentId: args.agentId,
    expectedOwner: args.expectedOwner,
    operatorVaults: args.operatorVaults,
  })
  if (result.ok) return { kind: 'linked', onChainOwner: result.ownerAddress }
  if (result.reason === 'token-owner-lookup-failed') return { kind: 'unknown', detail: result.detail }
  return {
    kind: 'unlinked',
    detail: result.detail,
    agentId: args.agentId.toString(),
    ...(result.ownerAddress ? { onChainOwner: result.ownerAddress } : {}),
  }
}

function fallbackToken(): TokenProbe {
  return { kind: 'unknown', detail: 'token ownership probe failed' }
}

type CustodyProbe = { kind: 'simple' | 'advanced' | 'withdrawn' | 'mid-flow-uri-pending' | 'unknown' }

async function probeCustody(args: {
  client: PublicClient
  registry: Erc8004RegistryConfig
  agentId: bigint
  expectedOwner: Address
  vaultAddress?: Address
  identity: EthagentIdentity
}): Promise<CustodyProbe> {
  if (!args.vaultAddress) return { kind: 'simple' }
  try {
    const status = await isAgentInVault({
      client: args.client,
      vaultAddress: args.vaultAddress,
      registry: args.registry.identityRegistryAddress,
      agentId: args.agentId,
    })
    if (!status.inVault) return { kind: 'withdrawn' }
    const localUri = args.identity.agentUri ?? args.identity.backup?.agentUri
    if (localUri) {
      try {
        const onChain = await args.client.readContract({
          address: args.registry.identityRegistryAddress,
          abi: ERC8004_AGENT_URI_ABI,
          functionName: 'agentURI',
          args: [args.agentId],
        }) as string
        if (onChain && onChain !== localUri) {
          return { kind: 'mid-flow-uri-pending' }
        }
      } catch {
      }
    }
    if (status.ownerAddress?.toLowerCase() === args.expectedOwner.toLowerCase()) {
      return { kind: 'advanced' }
    }
    return { kind: 'advanced' }
  } catch {
    return { kind: 'unknown' }
  }
}

type AgentUriProbe = { kind: 'in-sync' | 'chain-newer' | 'local-newer' | 'unknown' }

const ERC8004_AGENT_URI_ABI = [
  {
    type: 'function',
    name: 'agentURI',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

async function probeAgentUri(args: {
  client: PublicClient
  registry: Erc8004RegistryConfig
  agentId: bigint
  identity: EthagentIdentity
}): Promise<AgentUriProbe> {
  const localUri = args.identity.agentUri ?? args.identity.backup?.agentUri
  if (!localUri) return { kind: 'unknown' }
  try {
    const onChain = await args.client.readContract({
      address: args.registry.identityRegistryAddress,
      abi: ERC8004_AGENT_URI_ABI,
      functionName: 'agentURI',
      args: [args.agentId],
    }) as string
    if (onChain === localUri) return { kind: 'in-sync' }
    if (!onChain) return { kind: 'local-newer' }
    return { kind: 'local-newer' }
  } catch {
    return { kind: 'unknown' }
  }
}

type VaultProbe = { kind: 'confirmed' | 'missing' | 'unset' | 'unknown' }

async function probeVault(args: {
  client: PublicClient
  vaultAddress?: Address
}): Promise<VaultProbe> {
  if (!args.vaultAddress) return { kind: 'unset' }
  try {
    const code = await args.client.getBytecode({ address: args.vaultAddress })
    if (!code || code === '0x') return { kind: 'missing' }
    return { kind: 'confirmed' }
  } catch {
    return { kind: 'unknown' }
  }
}

type WorkingTreeProbe = { kind: 'clean' | 'dirty' | 'unknown' }

async function probeWorkingTree(identity: EthagentIdentity): Promise<WorkingTreeProbe> {
  try {
    const [latest] = await listPublishedContinuitySnapshots(identity, 1)
    const status: ContinuityWorkingTreeStatus = await continuityWorkingTreeStatus(identity, latest)
    if (!status.ready) return { kind: 'unknown' }
    return status.localChangedAfterBackup ? { kind: 'dirty' } : { kind: 'clean' }
  } catch {
    return { kind: 'unknown' }
  }
}

function unwrap<T>(result: PromiseSettledResult<T>, fallback: () => T): T {
  if (result.status === 'fulfilled') return result.value
  return fallback()
}

function computeDriftCount(r: AgentReconciliation): number {
  let n = 0
  if (r.token === 'unlinked') n++
  if (r.custody === 'mid-flow-uri-pending') n++
  if ((r.agentUri === 'local-newer' || r.agentUri === 'chain-newer') && r.custody !== 'mid-flow-uri-pending') n++
  if (r.vault === 'missing') n++
  if (r.workingTree === 'dirty') n++
  return n
}
