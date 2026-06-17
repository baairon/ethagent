import type { Address, Hex, PublicClient } from 'viem'
import {
  DEFAULT_ETHEREUM_RPC_URL,
  RegisterAgentPreflightError,
  createErc8004PublicClient,
  supportedErc8004ChainForId,
} from '../../registry/erc8004.js'
import { encodeSetEnsip25TextRecord, readEthagentTextRecords } from '../../ens/ensLookup.js'
import { encodeEnsRecordsTransaction, encodeEnsRegistryTransaction, readAddressRecord, type EnsSetupPlan } from '../../ens/ensAutomation.js'
import type { AgentEnsRecordState, AgentEnsRecords, AgentRecordDiff } from '../../ens/agentRecords.js'
import { changedRecords, clearedRecords, diffRecords } from '../../ens/agentRecords.js'
import { namehash, getAddress } from 'viem'
import { prepareTransactionGasFee, sendBrowserWalletTransaction, type BrowserWalletSession, type WalletPurpose } from '../../wallet/browserWallet.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
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
}): Promise<{ txHash: string } | { skipped: true }> {
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const queryKeys = Array.from(new Set([
    ...Object.keys(args.records ?? {}),
    ...Object.keys(args.currentRecords ?? {}),
  ]))
  let freshCurrent: AgentEnsRecordState = args.currentRecords ?? {}
  if (queryKeys.length > 0) {
    try {
      freshCurrent = await readEthagentTextRecords(args.fullName, queryKeys, { publicClient })
    } catch {
      freshCurrent = args.currentRecords ?? {}
    }
  }
  const next = ensRecordWritesForUpdate({
    records: args.records,
    currentRecords: freshCurrent,
    clearRecords: args.clearRecords,
  })
  if (Object.keys(next).length === 0) {
    return { skipped: true }
  }
  const encoded = await encodeSetEnsip25TextRecord(args.fullName, next, { publicClient })
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
  const gasFee = await prepareTransactionGasFee({
    client: publicClient,
    account: args.ownerAddress,
    to: encoded.resolverAddress,
    data: encoded.data,
  })
  if (args.session) {
    const result = await args.session.sendTransaction({
      chainId: 1,
      expectedAccount: args.ownerAddress,
      to: encoded.resolverAddress,
      data: encoded.data,
      ...gasFee,
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
    ...gasFee,
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
  const current = args.currentRecords ?? {}
  if (args.clearRecords) {
    return changedRecords(current, clearedRecords(current))
  }
  return changedRecords(current, args.records)
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
  const gasFee = await prepareTransactionGasFee({
    client: publicClient,
    account: args.setup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
  })
  if (args.session) {
    const result = await args.session.sendTransaction({
      chainId: 1,
      expectedAccount: args.setup.ownerAddress,
      to: encoded.to,
      data: encoded.data,
      ...gasFee,
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
    ...gasFee,
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
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const freshSetup = await refreshEnsSetupAgainstChain(args.setup, publicClient)
  const encoded = encodeEnsRecordsTransaction(freshSetup)
  if (!encoded) return null
  const purpose: WalletPurpose = freshSetup.mode === 'simple' ? 'set-simple-ens-records' : 'set-agent-ens-records'
  await preflightEnsRecordTransaction({
    fullName: freshSetup.fullName,
    account: freshSetup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
    publicClient,
    purpose,
  })
  const tokenChainName = typeof args.tokenChainId === 'number' ? ensTokenChainName(args.tokenChainId) : undefined
  const gasFee = await prepareTransactionGasFee({
    client: publicClient,
    account: freshSetup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
  })
  if (args.session) {
    const result = await args.session.sendTransaction({
      chainId: 1,
      expectedAccount: freshSetup.ownerAddress,
      to: encoded.to,
      data: encoded.data,
      ...gasFee,
      purpose,
      ...(tokenChainName ? { tokenChainName } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
    })
    return { txHash: result.txHash }
  }
  const result = await sendBrowserWalletTransaction({
    chainId: 1,
    expectedAccount: freshSetup.ownerAddress,
    to: encoded.to,
    data: encoded.data,
    ...gasFee,
    purpose,
    onReady: args.callbacks.onWalletReady,
    ...(tokenChainName ? { tokenChainName } : {}),
  })
  args.callbacks.onWalletReady(null)
  return { txHash: result.txHash }
}

async function refreshEnsSetupAgainstChain(setup: EnsSetupPlan, publicClient: PublicClient): Promise<EnsSetupPlan> {
  if (setup.registryAction !== 'none' && !setup.recordDiffs.length && !setup.addressRecord.changed) {
    return setup
  }
  const node = namehash(setup.fullName)
  const keys = Array.from(new Set(setup.recordDiffs.map(diff => diff.key)))
  let freshCurrent: AgentEnsRecordState = setup.currentRecords
  if (keys.length > 0) {
    try {
      freshCurrent = await readEthagentTextRecords(setup.fullName, keys, { publicClient })
    } catch {
      freshCurrent = setup.currentRecords
    }
  }
  let freshAddress = setup.addressRecord.current
  try {
    freshAddress = await readAddressRecord(publicClient, setup.resolverAddress, node)
  } catch {
    freshAddress = setup.addressRecord.current
  }
  const addressChanged = !freshAddress || getAddress(freshAddress).toLowerCase() !== getAddress(setup.addressRecord.next).toLowerCase()
  const recordDiffs: AgentRecordDiff[] = diffRecords(freshCurrent, setup.nextRecords)
  return {
    ...setup,
    currentRecords: freshCurrent,
    recordDiffs,
    addressRecord: {
      current: freshAddress,
      next: setup.addressRecord.next,
      changed: addressChanged,
    },
  }
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
