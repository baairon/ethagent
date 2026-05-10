import { encodeDeployData, getAddress, type Address, type Hex, type PublicClient } from 'viem'
import {
  confirmAgentWithdrawnFromVault,
  encodeDepositAgent,
  encodeUnwrapAgent,
  isAgentInVault,
  resolveConfiguredOperatorVaultAddress,
  OPERATOR_VAULT_ABI,
  OPERATOR_VAULT_DEPLOY_BYTECODE,
  assertVaultBytecode,
} from '../../../registry/operatorVault.js'
import {
  createErc8004PublicClient,
  type Erc8004RegistryConfig,
} from '../../../registry/erc8004.js'
import type { EthagentIdentity } from '../../../../storage/config.js'
import { readOperatorVaultAddressField, readOwnerAddressField } from '../../../identityCompat.js'
import { prepareTransactionGasFee, sendBrowserWalletTransaction } from '../../../wallet/browserWallet.js'
import { acquireTxGuard, releaseTxGuard, type TxGuardKind } from '../../txGuard.js'
import { awaitConfirmedReceipt } from '../../effects/receipts.js'
import type { EffectCallbacks } from '../../effects/types.js'
import { readCustodyMode } from '../../model/custody.js'

export function resolveOperatorVaultAddress(
  identity: EthagentIdentity,
  operatorVaults?: Readonly<Record<string, string>>,
): Address | undefined {
  const identityVault = readOperatorVaultAddressField(identity.state as Record<string, unknown> | undefined)
  if (identityVault) return getAddress(identityVault)
  if (readCustodyMode(identity.state as Record<string, unknown> | undefined) !== 'advanced') return undefined
  if (!identity.chainId) return undefined
  return resolveConfiguredOperatorVaultAddress(operatorVaults, identity.chainId)
}

async function withTxGuard<T>(kind: TxGuardKind, fn: () => Promise<T>): Promise<T> {
  acquireTxGuard(kind)
  try {
    return await fn()
  } finally {
    releaseTxGuard(kind)
  }
}

export async function runVaultDeployTransaction(args: {
  registry: Erc8004RegistryConfig
  walletAddress: Address
  agentId: bigint
  callbacks: EffectCallbacks
  publicClient?: Pick<PublicClient, 'waitForTransactionReceipt' | 'getBytecode'>
  flowId?: string
}): Promise<{ txHash: Hex; vaultAddress: Address }> {
  return withTxGuard('vault-deploy', () => runVaultDeployTransactionInner(args))
}

async function runVaultDeployTransactionInner(args: {
  registry: Erc8004RegistryConfig
  walletAddress: Address
  agentId: bigint
  callbacks: EffectCallbacks
  publicClient?: Pick<PublicClient, 'waitForTransactionReceipt' | 'getBytecode'>
  flowId?: string
}): Promise<{ txHash: Hex; vaultAddress: Address }> {
  const walletAddress = getAddress(args.walletAddress)
  const registryAddress = getAddress(args.registry.identityRegistryAddress)
  const deployData = encodeDeployData({
    abi: OPERATOR_VAULT_ABI,
    bytecode: OPERATOR_VAULT_DEPLOY_BYTECODE,
    args: [registryAddress, args.agentId],
  })
  const gasFeeClient = createErc8004PublicClient(args.registry)
  const gasFee = await prepareTransactionGasFee({
    client: gasFeeClient,
    account: walletAddress,
    data: deployData,
  })
  const result = await sendBrowserWalletTransaction({
    chainId: args.registry.chainId,
    expectedAccount: walletAddress,
    data: deployData,
    gas: gasFee.gas,
    maxFeePerGas: gasFee.maxFeePerGas,
    maxPriorityFeePerGas: gasFee.maxPriorityFeePerGas,
    purpose: 'deploy-agent-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.flowId ? { flowId: args.flowId } : {}),
  })
  args.callbacks.onWalletReady(null)
  const client = args.publicClient ?? createErc8004PublicClient(args.registry)
  const receipt = await awaitConfirmedReceipt(client, result.txHash, 'Operator delegation vault deploy', { kind: 'vault-deploy', chainId: args.registry.chainId })
  if (!receipt.contractAddress) {
    throw new Error('Operator delegation vault deploy receipt is missing contractAddress; the transaction was not a contract creation')
  }
  const vaultAddress = getAddress(receipt.contractAddress)
  await assertVaultBytecode(client, vaultAddress, result.txHash)
  return { txHash: result.txHash, vaultAddress }
}

export async function runVaultDepositTransaction(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  flowId?: string
}): Promise<{ txHash: string }> {
  return withTxGuard('vault-deposit', () => runVaultDepositTransactionInner(args))
}

async function runVaultDepositTransactionInner(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  flowId?: string
}): Promise<{ txHash: string }> {
  const { identity, registry, vaultAddress } = args
  if (!identity.agentId) {
    throw new Error('Cannot deposit token to operator delegation vault: agent token ID is missing')
  }
  const tokenOwner = getAddress(identity.ownerAddress ?? identity.address)
  await assertVaultCanAcceptAgent({
    registry,
    vaultAddress,
    agentId: BigInt(identity.agentId),
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
  const result = await sendBrowserWalletTransaction({
    chainId: registry.chainId,
    expectedAccount: tokenOwner,
    to: encoded.to,
    data: encoded.data,
    gas: gasFee.gas,
    maxFeePerGas: gasFee.maxFeePerGas,
    maxPriorityFeePerGas: gasFee.maxPriorityFeePerGas,
    purpose: 'deposit-agent-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.flowId ? { flowId: args.flowId } : {}),
  })
  args.callbacks.onWalletReady(null)
  const depositClient = createErc8004PublicClient(registry)
  await awaitConfirmedReceipt(
    depositClient,
    result.txHash as Hex,
    'Operator delegation vault deposit',
    { kind: 'vault-deposit', chainId: registry.chainId },
  )
  return { txHash: result.txHash }
}

async function assertVaultCanAcceptAgent(args: {
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  agentId: bigint
}): Promise<void> {
  const client = createErc8004PublicClient(args.registry)
  let held: readonly [Address, bigint, Address]
  try {
    held = await client.readContract({
      address: getAddress(args.vaultAddress),
      abi: OPERATOR_VAULT_ABI,
      functionName: 'heldAgent',
    }) as readonly [Address, bigint, Address]
  } catch {
    return
  }
  const [heldRegistry, heldAgentId, heldOwner] = held
  if (!heldOwner || heldOwner.toLowerCase() === '0x0000000000000000000000000000000000000000') return
  const expectedRegistry = getAddress(args.registry.identityRegistryAddress)
  const sameAgent = heldRegistry.toLowerCase() === expectedRegistry.toLowerCase() && heldAgentId === args.agentId
  if (sameAgent) {
    throw new Error(`Agent vault ${getAddress(args.vaultAddress)} already holds ERC-8004 token #${args.agentId.toString()}. Publish the pending update instead of depositing again.`)
  }
  throw new Error(`Agent vault ${getAddress(args.vaultAddress)} already holds ERC-8004 token #${heldAgentId.toString()} for registry ${getAddress(heldRegistry)}. Deploy a fresh vault for this agent.`)
}

export async function runVaultUnwrapTransaction(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
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
  flowId?: string
  agentId?: bigint
}): Promise<{ txHash: string } | null> {
  const { identity, registry, vaultAddress } = args
  const targetAgentId = args.agentId ?? (identity.agentId ? BigInt(identity.agentId) : undefined)
  if (targetAgentId === undefined) {
    throw new Error('Cannot unwrap token from operator delegation vault: agent token ID is missing')
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
  const result = await sendBrowserWalletTransaction({
    chainId: registry.chainId,
    expectedAccount: ownerAddress,
    to: encoded.to,
    data: encoded.data,
    purpose: 'unwrap-agent-vault',
    onReady: args.callbacks.onWalletReady,
    ...(args.flowId ? { flowId: args.flowId } : {}),
  })
  args.callbacks.onWalletReady(null)
  await awaitConfirmedReceipt(
    publicClient,
    result.txHash as Hex,
    'Operator delegation vault unwrap',
    { kind: 'vault-unwrap', chainId: registry.chainId },
  )
  await confirmAgentWithdrawnFromVault({
    client: publicClient,
    vaultAddress,
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
    recipient: ownerAddress,
  })
  return { txHash: result.txHash }
}

export async function runVaultWithdrawTransaction(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
  agentId?: bigint
}): Promise<{ txHash: string; recipient: Address }> {
  return withTxGuard('vault-withdraw', () => runVaultWithdrawTransactionInner(args))
}

async function runVaultWithdrawTransactionInner(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  callbacks: EffectCallbacks
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
  const result = await sendBrowserWalletTransaction({
    chainId: registry.chainId,
    expectedAccount: recipient,
    to: encoded.to,
    data: encoded.data,
    purpose: 'withdraw-vault',
    onReady: args.callbacks.onWalletReady,
  })
  args.callbacks.onWalletReady(null)
  await awaitConfirmedReceipt(
    publicClient,
    result.txHash as Hex,
    'Operator delegation vault withdraw',
    { kind: 'vault-withdraw', chainId: registry.chainId },
  )
  await confirmAgentWithdrawnFromVault({
    client: publicClient,
    vaultAddress,
    registry: getAddress(registry.identityRegistryAddress),
    agentId: targetAgentId,
    recipient,
  })
  return { txHash: result.txHash, recipient }
}
