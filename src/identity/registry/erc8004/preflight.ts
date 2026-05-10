import type { Address, Hex } from 'viem'
import type { Erc8004RegistryConfig } from './types.js'
import { createErc8004PublicClient } from './client.js'
import { encodeRegisterAgent, encodeSetAgentUri } from './transactions.js'
import { cleanRpcError, formatEthAmount } from './utils.js'

export type RegisterAgentPreflight = {
  gas: bigint
  gasPrice: bigint
  estimatedCostWei: bigint
  requiredBalanceWei: bigint
  balanceWei: bigint
}

export type RegisterAgentPreflightErrorCode = 'insufficient-funds' | 'simulation-failed'

export class RegisterAgentPreflightError extends Error {
  code: RegisterAgentPreflightErrorCode
  title: string
  detail: string
  hint: string
  requiredBalanceWei?: bigint
  balanceWei?: bigint

  constructor(args: {
    code: RegisterAgentPreflightErrorCode
    title: string
    detail: string
    hint: string
    requiredBalanceWei?: bigint
    balanceWei?: bigint
  }) {
    super(args.detail ? `${args.title}: ${args.detail}` : args.title)
    this.name = 'RegisterAgentPreflightError'
    this.code = args.code
    this.title = args.title
    this.detail = args.detail
    this.hint = args.hint
    this.requiredBalanceWei = args.requiredBalanceWei
    this.balanceWei = args.balanceWei
  }
}

type RegisterAgentPreflightClient = {
  estimateGas: (args: { account: Address; to: Address; data: Hex }) => Promise<bigint>
  getGasPrice: () => Promise<bigint>
  getBalance: (args: { address: Address }) => Promise<bigint>
}

export async function preflightRegisterAgent(args: Erc8004RegistryConfig & {
  ownerAddress: Address
  agentURI: string
  publicClient?: RegisterAgentPreflightClient
}): Promise<RegisterAgentPreflight> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args) as RegisterAgentPreflightClient
  const data = encodeRegisterAgent({ agentURI: args.agentURI })
  let gas: bigint
  try {
    gas = await publicClient.estimateGas({
      account: args.ownerAddress,
      to: args.identityRegistryAddress,
      data,
    })
  } catch (err: unknown) {
    throw new RegisterAgentPreflightError({
      code: 'simulation-failed',
      title: 'Registration Blocked',
      detail: cleanRpcError(err),
      hint: 'No transaction was sent.',
    })
  }
  const [gasPrice, balance] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: args.ownerAddress }),
  ])
  const estimatedCost = gas * gasPrice
  const requiredBalance = estimatedCost + estimatedCost / 5n
  if (balance < requiredBalance) {
    throw new RegisterAgentPreflightError({
      code: 'insufficient-funds',
      title: 'Not Enough ETH',
      detail: `Need ~${formatEthAmount(requiredBalance)} ETH. Wallet has ${formatEthAmount(balance)} ETH.`,
      hint: 'Add ETH to this wallet, then try again.',
      requiredBalanceWei: requiredBalance,
      balanceWei: balance,
    })
  }
  return {
    gas,
    gasPrice,
    estimatedCostWei: estimatedCost,
    requiredBalanceWei: requiredBalance,
    balanceWei: balance,
  }
}

export async function preflightSetAgentUri(args: Erc8004RegistryConfig & {
  account: Address
  agentId: bigint
  newUri: string
  publicClient?: RegisterAgentPreflightClient
}): Promise<void> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args) as RegisterAgentPreflightClient
  const data = encodeSetAgentUri({ agentId: args.agentId, newUri: args.newUri })
  try {
    await publicClient.estimateGas({
      account: args.account,
      to: args.identityRegistryAddress,
      data,
    })
  } catch (err: unknown) {
    const detail = cleanRpcError(err)
    const looksLikeOwnershipRevert = /not.*owner|owner.*only|unauthor|forbidden|caller/i.test(detail)
    throw new RegisterAgentPreflightError({
      code: 'simulation-failed',
      title: 'Backup Update Blocked',
      detail,
      hint: looksLikeOwnershipRevert
        ? `Connect the wallet that owns this agent (${args.account}) and try again.`
        : 'No transaction was sent.',
    })
  }
}
