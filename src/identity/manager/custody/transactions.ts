import { encodeDeployData, getAddress, type Address, type Hex, type PublicClient } from 'viem'
import {
  confirmAgentWithdrawnFromVault,
  encodeDepositAgent,
  encodeUnwrapAgent,
  isAgentInVault,
  resolveConfiguredVaultAddress,
  VAULT_ABI,
  VAULT_DEPLOY_BYTECODE,
  assertVaultBytecode,
  VaultBytecodeMismatchError,
} from '../../registry/vault.js'
import {
  blockTimeMsForChain,
  createErc8004PublicClient,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { describeVaultRevert, isNotAContractAnswer, type VaultBuild, type VaultCheckPacing } from '../../registry/vault.js'
import { loadConfig, saveConfigWithMerge, setConfiguredVaultAddress, type EthagentIdentity } from '../../../storage/config.js'
import { readVaultAddressField, readOwnerAddressField } from '../../identityCompat.js'
import {
  prepareTransactionGasFee,
  sendBrowserWalletTransaction,
  type BrowserWalletSession,
  type BrowserWalletTransaction,
  type TransactionRequest,
} from '../../wallet/browserWallet.js'
import { acquireTxGuard, releaseTxGuard, type TxGuardKind } from '../shared/txGuard.js'
import { awaitConfirmedReceipt } from '../shared/effects/receipts.js'
import { invalidateOwnershipCache } from '../shared/reconciliation/agentReconciliation/ownership.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { readCustodyMode } from './state.js'

export function resolveVaultAddress(
  identity: EthagentIdentity,
  operatorVaults?: Readonly<Record<string, string>>,
): Address | undefined {
  const identityVault = readVaultAddressField(identity.state as Record<string, unknown> | undefined)
  if (identityVault) return getAddress(identityVault)
  if (readCustodyMode(identity.state as Record<string, unknown> | undefined) !== 'advanced') return undefined
  if (!identity.chainId) return undefined
  return resolveConfiguredVaultAddress(operatorVaults, identity.chainId)
}

// Saves a freshly deployed Vault's address as soon as the deploy receipt names it, so
// a retry after a failed check or a closed screen reuses it instead of deploying again.
export async function recordDeployedVault(chainId: number, vaultAddress: Address): Promise<void> {
  await saveConfigWithMerge(current => {
    if (!current) throw new Error('Cannot record the new Vault: no ethagent config is saved')
    return setConfiguredVaultAddress(current, chainId, getAddress(vaultAddress))
  })
}

// A Vault recorded by an earlier deploy that this token can still go into. The Vault
// binds its registry and token at deploy time, and only the simulated deposit can tell
// which token that is, so a refusal there means "deploy a new one". Unanswered reads
// surface as errors.
export async function findReusableDeployedVault(args: {
  registry: Erc8004RegistryConfig
  agentId: bigint
  owner: Address
}): Promise<Address | undefined> {
  const config = await loadConfig()
  const recorded = config?.erc8004?.operatorVaults?.[String(args.registry.chainId)]
  if (!recorded) return undefined
  const vaultAddress = getAddress(recorded)
  const client = createErc8004PublicClient(args.registry)
  let build: VaultBuild
  try {
    build = await assertVaultBytecode(client, vaultAddress, undefined, { blockTimeMs: blockTimeMsForChain(args.registry.chainId) })
  } catch (err: unknown) {
    if (err instanceof VaultBytecodeMismatchError) return undefined
    throw err
  }
  try {
    await assertVaultCanAcceptAgent({ registry: args.registry, vaultAddress, agentId: args.agentId, build, owner: args.owner, client })
  } catch (err: unknown) {
    if (err instanceof VaultRefusedDepositError) return undefined
    throw err
  }
  return vaultAddress
}

export class VaultRefusedDepositError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VaultRefusedDepositError'
  }
}

// Sends one custody transaction: through the caller's wallet session when it has one,
// otherwise in a tab of its own.
async function sendCustodyTransaction(
  args: { session?: BrowserWalletSession; flowStep?: number },
  req: TransactionRequest,
): Promise<BrowserWalletTransaction> {
  const withStep: TransactionRequest = typeof args.flowStep === 'number' ? { ...req, flowStep: args.flowStep } : req
  if (args.session) {
    const { onReady: _onReady, signal: _signal, ...rest } = withStep
    return args.session.sendTransaction(rest)
  }
  return sendBrowserWalletTransaction(withStep)
}

async function withTxGuard<T>(kind: TxGuardKind, fn: () => Promise<T>): Promise<T> {
  acquireTxGuard(kind)
  try {
    return await fn()
  } finally {
    releaseTxGuard(kind)
    invalidateOwnershipCache()
  }
}

export async function runVaultDeployTransaction(args: {
  registry: Erc8004RegistryConfig
  walletAddress: Address
  agentId: bigint
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  publicClient?: Pick<PublicClient, 'waitForTransactionReceipt' | 'getBytecode' | 'getBlockNumber'>
  flowId?: string
  // Called as soon as the deploy receipt names the new Vault, before its code is
  // checked, so a retry after a failed check reuses this Vault instead of deploying again.
  onDeployed?: (vaultAddress: Address) => Promise<void> | void
}): Promise<{ txHash: Hex; vaultAddress: Address }> {
  return withTxGuard('vault-deploy', () => runVaultDeployTransactionInner(args))
}

async function runVaultDeployTransactionInner(args: {
  registry: Erc8004RegistryConfig
  walletAddress: Address
  agentId: bigint
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  publicClient?: Pick<PublicClient, 'waitForTransactionReceipt' | 'getBytecode' | 'getBlockNumber'>
  flowId?: string
  onDeployed?: (vaultAddress: Address) => Promise<void> | void
}): Promise<{ txHash: Hex; vaultAddress: Address }> {
  const walletAddress = getAddress(args.walletAddress)
  const registryAddress = getAddress(args.registry.identityRegistryAddress)
  const deployData = encodeDeployData({
    abi: VAULT_ABI,
    bytecode: VAULT_DEPLOY_BYTECODE,
    args: [registryAddress, args.agentId],
  })
  const gasFeeClient = createErc8004PublicClient(args.registry)
  const gasFee = await prepareTransactionGasFee({
    client: gasFeeClient,
    account: walletAddress,
    data: deployData,
  })
  const result = await sendCustodyTransaction(args, {
    chainId: args.registry.chainId,
    expectedAccount: walletAddress,
    data: deployData,
    gas: gasFee.gas,
    maxFeePerGas: gasFee.maxFeePerGas,
    maxPriorityFeePerGas: gasFee.maxPriorityFeePerGas,
    purpose: 'deploy-agent-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
  })
  args.callbacks.onWalletReady(null)
  const client = args.publicClient ?? createErc8004PublicClient(args.registry)
  const receipt = await awaitConfirmedReceipt(client, result.txHash, 'Vault deploy', { kind: 'vault-deploy', chainId: args.registry.chainId })
  if (!receipt.contractAddress) {
    throw new Error('Vault deploy receipt is missing contractAddress; the transaction was not a contract creation')
  }
  const vaultAddress = getAddress(receipt.contractAddress)
  await args.onDeployed?.(vaultAddress)
  await assertVaultBytecode(client, vaultAddress, result.txHash, receiptPacing(args.registry, client, receipt.blockNumber, args.callbacks.signal))
  return { txHash: result.txHash, vaultAddress }
}

export async function runVaultDepositTransaction(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  flowId?: string
}): Promise<{ txHash: string; receiptBlock: bigint; build: VaultBuild }> {
  return withTxGuard('vault-deposit', () => runVaultDepositTransactionInner(args))
}

async function runVaultDepositTransactionInner(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  flowId?: string
}): Promise<{ txHash: string; receiptBlock: bigint; build: VaultBuild }> {
  const { identity, registry, vaultAddress } = args
  if (!identity.agentId) {
    throw new Error('Cannot deposit token to Vault: agent token ID is missing')
  }
  const readClient = createErc8004PublicClient(registry)
  const build = await assertVaultBytecode(readClient, vaultAddress, undefined, {
    blockTimeMs: blockTimeMsForChain(registry.chainId),
    ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
  })
  const tokenOwner = getAddress(identity.ownerAddress ?? identity.address)
  await assertVaultCanAcceptAgent({
    registry,
    vaultAddress,
    agentId: BigInt(identity.agentId),
    build,
    owner: tokenOwner,
  })
  const encoded = encodeDepositAgent({
    registry: getAddress(registry.identityRegistryAddress),
    agentId: BigInt(identity.agentId),
    walletAddress: tokenOwner,
    vaultAddress,
  })
  const gasFeeClient = createErc8004PublicClient(registry)
  const gasFee = await prepareTransactionGasFee({
    client: gasFeeClient,
    account: tokenOwner,
    to: encoded.to,
    data: encoded.data,
  })
  const result = await sendCustodyTransaction(args, {
    chainId: registry.chainId,
    expectedAccount: tokenOwner,
    to: encoded.to,
    data: encoded.data,
    gas: gasFee.gas,
    maxFeePerGas: gasFee.maxFeePerGas,
    maxPriorityFeePerGas: gasFee.maxPriorityFeePerGas,
    purpose: 'deposit-agent-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
  })
  args.callbacks.onWalletReady(null)
  const depositClient = createErc8004PublicClient(registry)
  const receipt = await awaitConfirmedReceipt(
    depositClient,
    result.txHash as Hex,
    'Vault deposit',
    { kind: 'vault-deposit', chainId: registry.chainId },
  )
  return { txHash: result.txHash, receiptBlock: receipt.blockNumber, build }
}

export function receiptPacing(
  registry: Pick<Erc8004RegistryConfig, 'chainId'>,
  client: Partial<Pick<PublicClient, 'getBlockNumber'>>,
  receiptBlock: bigint | undefined,
  signal?: AbortSignal,
): VaultCheckPacing {
  const getBlockNumber = client.getBlockNumber?.bind(client)
  return {
    blockTimeMs: blockTimeMsForChain(registry.chainId),
    ...(receiptBlock !== undefined && getBlockNumber ? { receiptBlock, getBlockNumber: () => getBlockNumber() } : {}),
    ...(signal ? { signal } : {}),
  }
}

const ERC721_SAFE_TRANSFER_SIM_ABI = [{
  type: 'function',
  name: 'safeTransferFrom',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
  ],
  outputs: [],
}] as const

const ZERO = '0x0000000000000000000000000000000000000000'

// Checks the Vault can take this token before the wallet is asked. Builds with
// heldAgent() say what they hold; on every build agentOwner for this token must be
// empty. Then the deposit itself is simulated from the owner, which is the check every
// build agrees on. Failed reads surface as errors; they never count as "accept".
export async function assertVaultCanAcceptAgent(args: {
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  agentId: bigint
  build: VaultBuild
  owner: Address
  client?: Pick<PublicClient, 'readContract' | 'simulateContract'>
}): Promise<void> {
  const client = args.client ?? createErc8004PublicClient(args.registry)
  const vault = getAddress(args.vaultAddress)
  const expectedRegistry = getAddress(args.registry.identityRegistryAddress)
  if (args.build.hasHeldAgent) {
    const held = await client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'heldAgent',
    }) as readonly [Address, bigint, Address]
    const [heldRegistry, heldAgentId, heldOwner] = held
    if (heldOwner && heldOwner.toLowerCase() !== ZERO) {
      const sameAgent = heldRegistry.toLowerCase() === expectedRegistry.toLowerCase() && heldAgentId === args.agentId
      if (sameAgent) {
        throw new VaultRefusedDepositError(`Vault ${vault} already holds ERC-8004 token #${args.agentId.toString()}. Publish the pending update instead of depositing again.`)
      }
      throw new VaultRefusedDepositError(`Vault ${vault} already holds ERC-8004 token #${heldAgentId.toString()} for registry ${getAddress(heldRegistry)}. Deploy a fresh vault for this agent.`)
    }
  } else {
    const owner = await client.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: 'agentOwner',
      args: [expectedRegistry, args.agentId],
    }) as Address
    if (owner && owner.toLowerCase() !== ZERO) {
      throw new VaultRefusedDepositError(`Vault ${vault} already holds ERC-8004 token #${args.agentId.toString()}. Publish the pending update instead of depositing again.`)
    }
  }
  try {
    await client.simulateContract({
      account: getAddress(args.owner),
      address: expectedRegistry,
      abi: [...ERC721_SAFE_TRANSFER_SIM_ABI, ...VAULT_ABI.filter(item => item.type === 'error')],
      functionName: 'safeTransferFrom',
      args: [getAddress(args.owner), vault, args.agentId],
    })
  } catch (err: unknown) {
    if (!isNotAContractAnswer(err)) throw err
    const reason = describeVaultRevert(err)
    throw new VaultRefusedDepositError(
      `A simulated deposit into Vault ${vault} was refused${reason ? `: ${reason}` : ''}. Nothing was sent.`,
      { cause: err },
    )
  }
}

export async function runVaultUnwrapTransaction(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  flowId?: string
  agentId?: bigint
}): Promise<{ txHash: string } | null> {
  return withTxGuard('vault-unwrap', () => runVaultUnwrapTransactionInner(args))
}

async function runVaultUnwrapTransactionInner(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  flowId?: string
  agentId?: bigint
}): Promise<{ txHash: string } | null> {
  const { identity, registry, vaultAddress } = args
  const targetAgentId = args.agentId ?? (identity.agentId ? BigInt(identity.agentId) : undefined)
  if (targetAgentId === undefined) {
    throw new Error('Cannot unwrap token from Vault: agent token ID is missing')
  }
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const ownerAddressRaw = readOwnerAddressField(baseState)
  const ownerAddress = ownerAddressRaw
    ? getAddress(ownerAddressRaw)
    : getAddress(identity.ownerAddress ?? identity.address)
  const publicClient = createErc8004PublicClient(registry)
  const status = await isAgentInVault({
    client: publicClient,
    vaultAddress,
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
  })
  if (!status.inVault) return null
  const encoded = encodeUnwrapAgent({
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
    recipient: ownerAddress,
    vaultAddress,
  })
  const gasFee = await prepareTransactionGasFee({
    client: publicClient,
    account: ownerAddress,
    to: encoded.to,
    data: encoded.data,
  })
  const result = await sendCustodyTransaction(args, {
    chainId: registry.chainId,
    expectedAccount: ownerAddress,
    to: encoded.to,
    data: encoded.data,
    ...gasFee,
    purpose: 'unwrap-agent-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
  })
  args.callbacks.onWalletReady(null)
  const receipt = await awaitConfirmedReceipt(
    publicClient,
    result.txHash as Hex,
    'Vault unwrap',
    { kind: 'vault-unwrap', chainId: registry.chainId },
  )
  await confirmAgentWithdrawnFromVault({
    client: publicClient,
    vaultAddress,
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
    recipient: ownerAddress,
    pacing: receiptPacing(registry, publicClient, receipt.blockNumber, args.callbacks.signal),
  })
  return { txHash: result.txHash }
}

export async function runVaultWithdrawTransaction(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  agentId?: bigint
}): Promise<{ txHash: string; recipient: Address }> {
  return withTxGuard('vault-withdraw', () => runVaultWithdrawTransactionInner(args))
}

async function runVaultWithdrawTransactionInner(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  // When set, the wallet prompts go through this one tab instead of a tab each.
  session?: BrowserWalletSession
  flowStep?: number
  agentId?: bigint
}): Promise<{ txHash: string; recipient: Address }> {
  const { identity, registry, vaultAddress } = args
  const targetAgentId = args.agentId ?? (identity.agentId ? BigInt(identity.agentId) : undefined)
  if (targetAgentId === undefined) {
    throw new Error('Cannot withdraw token: agent token ID is missing')
  }
  const publicClient = createErc8004PublicClient(registry)
  const status = await isAgentInVault({
    client: publicClient,
    vaultAddress,
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
  })
  if (!status.inVault) {
    throw new Error('Token is not currently held by the vault, nothing to unwrap')
  }
  if (!status.ownerAddress) {
    throw new Error('Vault has no recorded depositor for this token; cannot determine recipient')
  }
  const recipient = getAddress(status.ownerAddress)
  const encoded = encodeUnwrapAgent({
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
    recipient,
    vaultAddress,
  })
  const gasFee = await prepareTransactionGasFee({
    client: publicClient,
    account: recipient,
    to: encoded.to,
    data: encoded.data,
  })
  const result = await sendCustodyTransaction(args, {
    chainId: registry.chainId,
    expectedAccount: recipient,
    to: encoded.to,
    data: encoded.data,
    ...gasFee,
    purpose: 'withdraw-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
  })
  args.callbacks.onWalletReady(null)
  const receipt = await awaitConfirmedReceipt(
    publicClient,
    result.txHash as Hex,
    'Vault withdraw',
    { kind: 'vault-withdraw', chainId: registry.chainId },
  )
  await confirmAgentWithdrawnFromVault({
    client: publicClient,
    vaultAddress,
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
    recipient,
    pacing: receiptPacing(registry, publicClient, receipt.blockNumber, args.callbacks.signal),
  })
  return { txHash: result.txHash, recipient }
}
