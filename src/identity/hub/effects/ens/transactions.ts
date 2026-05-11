import type { Address, Hex, PublicClient } from 'viem'
import {
  DEFAULT_ETHEREUM_RPC_URL,
  RegisterAgentPreflightError,
  createErc8004PublicClient,
  supportedErc8004ChainForId,
} from '../../../registry/erc8004.js'
import { encodeSetEthagentTextRecords } from '../../../ens/ensLookup.js'
import { encodeEnsRecordsTransaction, encodeEnsRegistryTransaction, type EnsSetupPlan } from '../../../ens/ensAutomation.js'
import type { AgentEnsRecordState, AgentEnsRecords } from '../../../ens/agentRecords.js'
import { changedRecords } from '../../../ens/agentRecords.js'
import { sendBrowserWalletTransaction, type BrowserWalletSession, type WalletPurpose } from '../../../wallet/browserWallet.js'
import type { EffectCallbacks } from '../types.js'
function chainLabel(chainId: number): string {
  return supportedErc8004ChainForId(chainId)?.name ?? `chain ${chainId}`
}

function ensTokenChainName(chainId: number): string | undefined {
  return chainId !== 1 ? chainLabel(chainId) : undefined
}

export async function runUpdateEnsRecords(args: {
  fullName: string
  ownerAddress: Address
  records: AgentEnsRecords
  currentRecords?: AgentEnsRecordState
  callbacks: EffectCallbacks
  purpose?: WalletPurpose
  clearRecords?: boolean
  publicClient?: PublicClient
  tokenChainId?: number
  session?: BrowserWalletSession
  flowId?: string
  flowStep?: number
}): Promise<{ txHash: string }> {
  const next = ensRecordWritesForUpdate({
    records: args.records,
    currentRecords: args.currentRecords,
    clearRecords: args.clearRecords,
  })
  if (Object.keys(next).length === 0) {
    throw new Error('No ENS records to update')
  }
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const encoded = await encodeSetEthagentTextRecords(args.fullName, next, { publicClient })
  await preflightEnsRecordTransaction({
    fullName: args.fullName,
    account: args.ownerAddress,
    to: encoded.resolverAddress,
    data: encoded.data,
    publicClient,
    purpose: args.purpose ?? 'update-ens-records',
  })
  const tokenChainName = typeof args.tokenChainId === 'number' ? ensTokenChainName(args.tokenChainId) : undefined
  const purpose = args.purpose ?? 'update-ens-records'
  if (args.session) {
    const result = await args.session.sendTransaction({
      chainId: 1,
      expectedAccount: args.ownerAddress,
      to: encoded.resolverAddress,
      data: encoded.data,
      purpose,
      ...(tokenChainName ? { tokenChainName } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
    })
    return { txHash: result.txHash }
  }
  const result = await sendBrowserWalletTransaction({
    chainId: 1,
    expectedAccount: args.ownerAddress,
    to: encoded.resolverAddress,
    data: encoded.data,
    purpose,
    onReady: args.callbacks.onWalletReady,
    ...(tokenChainName ? { tokenChainName } : {}),
  })
  args.callbacks.onWalletReady(null)
  return { txHash: result.txHash }
}

export function ensRecordWritesForUpdate(args: {
  records: AgentEnsRecords
  currentRecords?: AgentEnsRecordState
  clearRecords?: boolean
}): Record<string, string> {
  if (args.clearRecords) {
    return changedRecords(args.currentRecords ?? {}, { token: '' })
  }
  return changedRecords(args.currentRecords ?? { token: '' }, args.records)
}

export async function runEnsSetupRegistryTransaction(args: {
  setup: EnsSetupPlan
  callbacks: EffectCallbacks
  publicClient?: PublicClient
  tokenChainId?: number
  session?: BrowserWalletSession
  flowId?: string
  flowStep?: number
}): Promise<{ txHash: string } | null> {
  const encoded = encodeEnsRegistryTransaction(args.setup)
  if (!encoded) return null
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const purpose: WalletPurpose = args.setup.mode === 'simple' ? 'create-simple-ens-subdomain' : 'create-agent-ens-subdomain'
  await preflightEnsRecordTransaction({
    fullName: args.setup.fullName,
    account: args.setup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
    publicClient,
    purpose,
  })
  const tokenChainName = typeof args.tokenChainId === 'number' ? ensTokenChainName(args.tokenChainId) : undefined
  if (args.session) {
    const result = await args.session.sendTransaction({
      chainId: 1,
      expectedAccount: args.setup.ownerAddress,
      to: encoded.to,
      data: encoded.data,
      purpose,
      ...(tokenChainName ? { tokenChainName } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
    })
    await publicClient.waitForTransactionReceipt({ hash: result.txHash })
    return { txHash: result.txHash }
  }
  const result = await sendBrowserWalletTransaction({
    chainId: 1,
    expectedAccount: args.setup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
    purpose,
    onReady: args.callbacks.onWalletReady,
    ...(tokenChainName ? { tokenChainName } : {}),
  })
  args.callbacks.onWalletReady(null)
  await publicClient.waitForTransactionReceipt({ hash: result.txHash })
  return { txHash: result.txHash }
}

export async function runEnsSetupRecordsTransaction(args: {
  setup: EnsSetupPlan
  callbacks: EffectCallbacks
  publicClient?: PublicClient
  tokenChainId?: number
  session?: BrowserWalletSession
  flowId?: string
  flowStep?: number
}): Promise<{ txHash: string } | null> {
  const encoded = encodeEnsRecordsTransaction(args.setup)
  if (!encoded) return null
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const purpose: WalletPurpose = args.setup.mode === 'simple' ? 'set-simple-ens-records' : 'set-agent-ens-records'
  await preflightEnsRecordTransaction({
    fullName: args.setup.fullName,
    account: args.setup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
    publicClient,
    purpose,
  })
  const tokenChainName = typeof args.tokenChainId === 'number' ? ensTokenChainName(args.tokenChainId) : undefined
  if (args.session) {
    const result = await args.session.sendTransaction({
      chainId: 1,
      expectedAccount: args.setup.ownerAddress,
      to: encoded.to,
      data: encoded.data,
      purpose,
      ...(tokenChainName ? { tokenChainName } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
    })
    return { txHash: result.txHash }
  }
  const result = await sendBrowserWalletTransaction({
    chainId: 1,
    expectedAccount: args.setup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
    purpose,
    onReady: args.callbacks.onWalletReady,
    ...(tokenChainName ? { tokenChainName } : {}),
  })
  args.callbacks.onWalletReady(null)
  return { txHash: result.txHash }
}

export function createMainnetEnsPublicClient(): PublicClient {
  return createErc8004PublicClient({
    chainId: 1,
    rpcUrl: DEFAULT_ETHEREUM_RPC_URL,
  })
}

async function preflightEnsRecordTransaction(args: {
  fullName: string
  account: Address
  to: Address
  data: Hex
  publicClient: Pick<PublicClient, 'estimateGas'>
  purpose: WalletPurpose
}): Promise<void> {
  try {
    await args.publicClient.estimateGas({
      account: args.account,
      to: args.to,
      data: args.data,
    })
  } catch (err: unknown) {
    throw new RegisterAgentPreflightError({
      code: 'simulation-failed',
      title: ensPreflightErrorTitle(args.purpose),
      detail: cleanPreflightError(err),
      hint: ensPreflightErrorHint(args),
    })
  }
}

function ensPreflightErrorTitle(_purpose: WalletPurpose): string {
  return 'ENS Record Update Blocked'
}

function ensPreflightErrorHint(args: {
  fullName: string
  purpose: WalletPurpose
}): string {
  const wallet = args.purpose === 'set-simple-ens-records' || args.purpose === 'update-ens-records' || args.purpose === 'clear-ens-records'
    ? 'ENS owner wallet'
    : 'owner wallet'
  return `No transaction was sent. Connect the ${wallet} and confirm it can write ENS resolver records on ${args.fullName}.`
}

function cleanPreflightError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err))
    .replace(/\s+/g, ' ')
    .slice(0, 220)
}
