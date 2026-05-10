import { getAddress, parseAbi, parseAbiItem, type Address, type PublicClient } from 'viem'
import { OPERATOR_VAULT_ABI } from './constants.js'
import { delayMs, OPERATOR_VAULT_POLL_DELAY_MS, OPERATOR_VAULT_POLL_MAX_ATTEMPTS } from './bytecode.js'

const DISCOVER_LOG_WINDOW_MAX_ATTEMPTS = 3
const DISCOVER_LOG_WINDOW_DELAY_MS = 2000

export type OperatorVaultReadClient = Pick<PublicClient, 'readContract'>

const ERC721_OWNER_OF_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
])

export type DiscoverPriorVaultClient = Pick<PublicClient, 'readContract' | 'getBytecode'>

export type DiscoverPriorVaultArgs = {
  client: DiscoverPriorVaultClient
  registry: Address
  agentId: bigint
  expectedOwner: Address
}

export async function discoverPriorVaultFromTokenOwner(
  args: DiscoverPriorVaultArgs,
): Promise<{ found: false } | { found: true; vaultAddress: Address }> {
  const registryAddr = getAddress(args.registry)
  const expected = getAddress(args.expectedOwner).toLowerCase()
  const tokenOwner = await args.client.readContract({
    address: registryAddr,
    abi: ERC721_OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [args.agentId],
  }) as Address
  if (!tokenOwner || tokenOwner.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { found: false }
  }
  if (tokenOwner.toLowerCase() === expected) {
    return { found: false }
  }
  const candidate = getAddress(tokenOwner)
  const code = await args.client.getBytecode({ address: candidate })
  if (!code || code === '0x') return { found: false }
  let vaultLevelOwner: Address
  try {
    vaultLevelOwner = await args.client.readContract({
      address: candidate,
      abi: OPERATOR_VAULT_ABI,
      functionName: 'agentOwner',
      args: [registryAddr, args.agentId],
    }) as Address
  } catch {
    return { found: false }
  }
  if (!vaultLevelOwner || vaultLevelOwner.toLowerCase() !== expected) {
    return { found: false }
  }
  return { found: true, vaultAddress: candidate }
}

export type IsAgentInVaultArgs = {
  client: OperatorVaultReadClient
  vaultAddress: Address
  registry: Address
  agentId: bigint
}

export async function isAgentInVault(
  args: IsAgentInVaultArgs,
): Promise<{ inVault: boolean; ownerAddress?: Address }> {
  const owner = await args.client.readContract({
    address: getAddress(args.vaultAddress),
    abi: OPERATOR_VAULT_ABI,
    functionName: 'agentOwner',
    args: [getAddress(args.registry), args.agentId],
  }) as Address
  if (!owner || owner.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { inVault: false }
  }
  return { inVault: true, ownerAddress: getAddress(owner) }
}

export async function confirmAgentInVault(
  args: IsAgentInVaultArgs,
): Promise<{ inVault: true; ownerAddress: Address }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < OPERATOR_VAULT_POLL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delayMs(OPERATOR_VAULT_POLL_DELAY_MS)
    try {
      const status = await isAgentInVault(args)
      lastErr = undefined
      if (status.inVault && status.ownerAddress) {
        return { inVault: true, ownerAddress: status.ownerAddress }
      }
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr) throw lastErr
  throw new Error(
    `OperatorVault ${getAddress(args.vaultAddress)} does not hold agent token #${args.agentId.toString()} for registry ${getAddress(args.registry)} after the deposit-confirmation budget was exhausted. The deposit transaction may have been re-orged or applied to the wrong vault. Re-run the switch.`,
  )
}

export type ConfirmAgentWithdrawnArgs = IsAgentInVaultArgs & {
  recipient: Address
}

export async function confirmAgentWithdrawnFromVault(
  args: ConfirmAgentWithdrawnArgs,
): Promise<{ inVault: false; ownerAddress: Address }> {
  const recipient = getAddress(args.recipient)
  let lastErr: unknown
  let lastObserved: string | undefined
  for (let attempt = 0; attempt < OPERATOR_VAULT_POLL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delayMs(OPERATOR_VAULT_POLL_DELAY_MS)
    try {
      const status = await isAgentInVault(args)
      const tokenOwner = await args.client.readContract({
        address: getAddress(args.registry),
        abi: ERC721_OWNER_OF_ABI,
        functionName: 'ownerOf',
        args: [args.agentId],
      }) as Address
      const ownerAddress = getAddress(tokenOwner)
      lastErr = undefined
      lastObserved = status.inVault
        ? `vault owner ${status.ownerAddress ?? 'unknown'}, token owner ${ownerAddress}`
        : `token owner ${ownerAddress}`
      if (!status.inVault && ownerAddress.toLowerCase() === recipient.toLowerCase()) {
        return { inVault: false, ownerAddress }
      }
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr) throw lastErr
  throw new Error(
    `OperatorVault ${getAddress(args.vaultAddress)} did not release agent token #${args.agentId.toString()} to ${recipient} after the withdraw-confirmation budget was exhausted. Last observed: ${lastObserved ?? 'unknown'}.`,
  )
}

const AGENT_DEPOSITED_EVENT = parseAbiItem(
  'event AgentDeposited(address indexed registry, uint256 indexed agentId, address indexed owner)',
)

export type DiscoverVaultedTokensArgs = {
  client: PublicClient
  vaultAddress: Address
  registry: Address
  depositorAddress: Address
  fromBlock?: bigint
}

const DISCOVER_VAULTED_TOKENS_BLOCK_WINDOW = 9_000n

export async function discoverVaultedTokens(
  args: DiscoverVaultedTokensArgs,
): Promise<Array<{ registry: Address; agentId: bigint }>> {
  const vaultAddr = getAddress(args.vaultAddress)
  const registryAddr = getAddress(args.registry)
  const depositor = getAddress(args.depositorAddress)
  const fromBlock = args.fromBlock ?? 0n
  const latest = await args.client.getBlockNumber()
  const fetchWindow = async (cursorFrom: bigint, cursorTo: bigint) =>
    args.client.getLogs({
      address: vaultAddr,
      event: AGENT_DEPOSITED_EVENT,
      args: { registry: registryAddr, owner: depositor },
      fromBlock: cursorFrom,
      toBlock: cursorTo,
    })
  type DepositLog = Awaited<ReturnType<typeof fetchWindow>>[number]
  const fetchWindowWithRetry = async (cursorFrom: bigint, cursorTo: bigint): Promise<DepositLog[]> => {
    let lastErr: unknown
    for (let attempt = 0; attempt < DISCOVER_LOG_WINDOW_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await delayMs(DISCOVER_LOG_WINDOW_DELAY_MS)
      try {
        return await fetchWindow(cursorFrom, cursorTo)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr ?? new Error(`failed to fetch AgentDeposited logs for window [${cursorFrom},${cursorTo}]`)
  }
  const logs: DepositLog[] = []
  let cursor = fromBlock
  while (cursor <= latest) {
    const windowEnd = cursor + DISCOVER_VAULTED_TOKENS_BLOCK_WINDOW - 1n
    const toBlock = windowEnd < latest ? windowEnd : latest
    const window = await fetchWindowWithRetry(cursor, toBlock)
    logs.push(...window)
    if (toBlock === latest) break
    cursor = toBlock + 1n
  }
  const seen = new Set<string>()
  const candidates: Array<{ registry: Address; agentId: bigint }> = []
  for (const log of logs) {
    const agentId = log.args.agentId
    if (agentId === undefined) continue
    const key = `${registryAddr.toLowerCase()}:${agentId.toString()}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ registry: registryAddr, agentId })
  }
  const out: Array<{ registry: Address; agentId: bigint }> = []
  for (const candidate of candidates) {
    const status = await isAgentInVault({
      client: args.client,
      vaultAddress: vaultAddr,
      registry: candidate.registry,
      agentId: candidate.agentId,
    })
    if (status.inVault && status.ownerAddress?.toLowerCase() === depositor.toLowerCase()) {
      out.push(candidate)
    }
  }
  return out
}

export type ReadMetadataOperatorsArgs = {
  client: OperatorVaultReadClient
  vaultAddress: Address
  registry: Address
  agentId: bigint
  candidates: readonly Address[]
}

export async function readMetadataOperators(
  args: ReadMetadataOperatorsArgs,
): Promise<Record<Address, boolean>> {
  const out: Record<Address, boolean> = {}
  for (const candidate of args.candidates) {
    try {
      const approved = await args.client.readContract({
        address: getAddress(args.vaultAddress),
        abi: OPERATOR_VAULT_ABI,
        functionName: 'metadataOperators',
        args: [getAddress(args.registry), args.agentId, getAddress(candidate)],
      }) as boolean
      out[candidate] = Boolean(approved)
    } catch {
      out[candidate] = false
    }
  }
  return out
}
