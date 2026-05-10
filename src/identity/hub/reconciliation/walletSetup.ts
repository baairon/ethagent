import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  namehash,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { mainnet } from 'viem/chains'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { Erc8004RegistryConfig } from '../../registry/erc8004.js'
import { ENS_AUTOMATION_RESOLVER_ABI } from '../../ens/ensAutomation.js'
import { encodeApprove, encodeApprovalRevoke, readDelegation } from '../../ens/resolverDelegation.js'
import { readResolverAddress } from '../../ens/ensLookup.js'
import { normalizeApprovedOperatorWallets } from '../operatorWallets.js'
import { readCustodyMode } from '../model/custody.js'
import { readOwnerAddressField } from '../../identityCompat.js'

export type ApprovalDiff = {
  added: Address[]
  removed: Address[]
}

export function computeApprovalDiff(
  beforeApproved: ReadonlyArray<{ address: string }>,
  afterApproved: ReadonlyArray<{ address: string }>,
): ApprovalDiff {
  const before = new Set(beforeApproved.map(record => record.address.toLowerCase()))
  const after = new Set(afterApproved.map(record => record.address.toLowerCase()))
  const added: Address[] = []
  const removed: Address[] = []
  for (const record of afterApproved) {
    if (!before.has(record.address.toLowerCase())) {
      added.push(getAddress(record.address))
    }
  }
  for (const record of beforeApproved) {
    if (!after.has(record.address.toLowerCase())) {
      removed.push(getAddress(record.address))
    }
  }
  return { added, removed }
}

type ResolverApprovalCalls = {
  resolverAddress: Address
  data: Hex
  calls: Hex[]
  added: Address[]
  removed: Address[]
}

export async function encodeResolverApprovalChanges(args: {
  ensName: string
  diff: ApprovalDiff
}): Promise<ResolverApprovalCalls | null> {
  if (args.diff.added.length === 0 && args.diff.removed.length === 0) return null
  const resolverAddress = await readResolverAddress(args.ensName)
  if (!resolverAddress) {
    throw new Error(`no resolver set on ${args.ensName} - finish ENS subdomain setup first`)
  }
  const node = namehash(args.ensName)
  const calls: Hex[] = []
  for (const address of args.diff.added) calls.push(encodeApprove(node, address))
  for (const address of args.diff.removed) calls.push(encodeApprovalRevoke(node, address))
  const data = calls.length === 1
    ? calls[0]!
    : encodeFunctionData({
        abi: ENS_AUTOMATION_RESOLVER_ABI,
        functionName: 'multicall',
        args: [calls],
      })
  return {
    resolverAddress,
    data,
    calls,
    added: args.diff.added,
    removed: args.diff.removed,
  }
}

export type RecordsFixPlanItem =
  | { kind: 'missing-approval'; address: Address }
  | { kind: 'stale-approval'; address: Address }
  | { kind: 'no-resolver' }
  | { kind: 'no-ens' }

export type RecordsFixPlan = {
  identityAgentId: string
  ensName: string | undefined
  items: RecordsFixPlanItem[]
}

type ReconcileArgs = {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  client?: Pick<PublicClient, 'readContract'>
}

export async function reconcileWalletSetup(
  args: ReconcileArgs,
): Promise<RecordsFixPlan> {
  const baseState = (args.identity.state ?? {}) as Record<string, unknown>
  const ensName = typeof baseState.ensName === 'string' ? baseState.ensName.trim() : ''
  const custodyMode = readCustodyMode(baseState)
  const approved = normalizeApprovedOperatorWallets(baseState.approvedOperatorWallets)
  const items: RecordsFixPlanItem[] = []

  if (custodyMode !== 'advanced' || approved.length === 0) {
    return { identityAgentId: String(args.identity.agentId ?? ''), ensName: ensName || undefined, items }
  }
  if (!ensName) {
    items.push({ kind: 'no-ens' })
    return { identityAgentId: String(args.identity.agentId ?? ''), ensName: undefined, items }
  }

  let resolverAddress: Address | null
  try {
    resolverAddress = await readResolverAddress(ensName)
  } catch {
    resolverAddress = null
  }
  if (!resolverAddress) {
    items.push({ kind: 'no-resolver' })
    return { identityAgentId: String(args.identity.agentId ?? ''), ensName, items }
  }

  const ownerAddress = readOwnerAddressField(baseState) ?? args.identity.ownerAddress ?? args.identity.address
  const node = namehash(ensName)

  for (const record of approved) {
    const isApproved = await readDelegation({
      client: args.client ?? createReadClient(),
      resolverAddress,
      ownerAddress: getAddress(ownerAddress),
      node,
      delegateAddress: getAddress(record.address),
    })
    if (!isApproved) {
      items.push({ kind: 'missing-approval', address: getAddress(record.address) })
    }
  }

  return { identityAgentId: String(args.identity.agentId ?? ''), ensName, items }
}

function createReadClient(): Pick<PublicClient, 'readContract'> {
  const transports = [
    http('https://ethereum.publicnode.com', { retryCount: 0, timeout: 8_000 }),
    http('https://eth.llamarpc.com', { retryCount: 0, timeout: 8_000 }),
  ]
  return createPublicClient({
    chain: mainnet,
    transport: fallback(transports, { retryCount: 0 }),
  })
}

type VerifyResolverApprovalsArgs = {
  ensName: string
  ownerAddress: Address
  resolverAddress: Address
  added: ReadonlyArray<Address>
  removed: ReadonlyArray<Address>
  client?: Pick<PublicClient, 'readContract'>
}

export async function verifyResolverApprovalsLanded(args: VerifyResolverApprovalsArgs): Promise<void> {
  if (args.added.length === 0 && args.removed.length === 0) return
  const client = args.client ?? createReadClient()
  const node = namehash(args.ensName)
  const owner = getAddress(args.ownerAddress)
  for (const address of args.added) {
    const delegate = getAddress(address)
    const isApproved = await readDelegation({
      client,
      resolverAddress: args.resolverAddress,
      ownerAddress: owner,
      node,
      delegateAddress: delegate,
    })
    if (!isApproved) {
      throw new Error(`Resolver delegation didn't land for operator wallet ${delegate}. Your wallet may have rejected the inner operation; retry by selecting Fix Records again.`)
    }
  }
  for (const address of args.removed) {
    const delegate = getAddress(address)
    const isApproved = await readDelegation({
      client,
      resolverAddress: args.resolverAddress,
      ownerAddress: owner,
      node,
      delegateAddress: delegate,
    })
    if (isApproved) {
      throw new Error(`Resolver revocation didn't land for operator wallet ${delegate}. Your wallet may have rejected the inner operation; retry by selecting Fix Records again.`)
    }
  }
}

export function fixPlanRequiresOwnerWallet(plan: RecordsFixPlan): boolean {
  return plan.items.some(item =>
    item.kind === 'missing-approval' || item.kind === 'stale-approval',
  )
}

export function describeFixPlanItem(item: RecordsFixPlanItem): string {
  switch (item.kind) {
    case 'missing-approval':
      return `operator wallet ${item.address} has no onchain resolver approval, record writes will be rejected`
    case 'stale-approval':
      return `operator wallet ${item.address} has an onchain approval that no longer matches the operator set`
    case 'no-resolver':
      return 'ENS subdomain has no resolver set yet, finish ENS setup before authorizing operator wallets onchain'
    case 'no-ens':
      return 'advanced mode requires an ENS subdomain so operator wallets can sign profile updates onchain'
  }
}
