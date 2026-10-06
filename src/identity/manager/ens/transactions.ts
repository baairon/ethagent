import type { Address, Hex, PublicClient } from 'viem'
import {
  blockTimeMsForChain,
  DEFAULT_ETHEREUM_RPC_URL,
  RegisterAgentPreflightError,
  createErc8004PublicClient,
  supportedErc8004ChainForId,
} from '../../registry/erc8004.js'
import { encodeSetEnsip25TextRecord, readEthagentTextRecords } from '../../ens/ensLookup.js'
import { encodeEnsRecordsTransaction, encodeEnsRegistryTransaction, readAddressRecord, type EnsSetupPlan, type EnsSubdomainDeletePlan } from '../../ens/ensAutomation.js'
import type { AgentEnsRecordState, AgentEnsRecords, AgentRecordDiff } from '../../ens/agentRecords.js'
import { changedRecords, clearedRecords, diffRecords } from '../../ens/agentRecords.js'
import { namehash, getAddress } from 'viem'
import { prepareTransactionGasFee, type BrowserWalletSession, type WalletPurpose } from '../../wallet/browserWallet.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { awaitConfirmedReceipt } from '../shared/effects/receipts.js'
import { browserEnsSigner, type EnsSigner } from './signer.js'
function chainLabel(chainId: number): string {
  return supportedErc8004ChainForId(chainId)?.name ?? `chain ${chainId}`
}

function ensTokenChainName(chainId: number): string | undefined {
  return chainId !== 1 ? chainLabel(chainId) : undefined
}

// Preflights, prices, sends and confirms one mainnet ENS transaction. The preflight
// and the gas estimate run from the signer's own account. The send returns only once
// the receipt is in and succeeded, so the next step reads what this one wrote.
export async function sendEnsTransaction(args: {
  signer: EnsSigner
  fullName: string
  to: Address
  data: Hex
  purpose: WalletPurpose
  publicClient: PublicClient
  callbacks: EffectCallbacks
  action: string
  tokenChainId?: number
  flowId?: string
  flowStep?: number
}): Promise<{ txHash: Hex }> {
  await preflightEnsRecordTransaction({
    fullName: args.fullName,
    account: args.signer.account,
    to: args.to,
    data: args.data,
    publicClient: args.publicClient,
    purpose: args.purpose,
  })
  const tokenChainName = typeof args.tokenChainId === 'number' ? ensTokenChainName(args.tokenChainId) : undefined
  const gasFee = await prepareTransactionGasFee({
    client: args.publicClient,
    account: args.signer.account,
    to: args.to,
    data: args.data,
    blockTimeMs: blockTimeMsForChain(1),
    ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
  })
  const { txHash } = await args.signer.send({
    to: args.to,
    data: args.data,
    ...gasFee,
    purpose: args.purpose,
    ...(tokenChainName ? { tokenChainName } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
    ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
  })
  await awaitConfirmedReceipt(args.publicClient, txHash, args.action, { kind: 'ens', chainId: 1 }, args.callbacks.signal)
  return { txHash }
}

function signerFor(args: {
  signer?: EnsSigner
  account: Address
  callbacks: EffectCallbacks
  session?: BrowserWalletSession
}): EnsSigner {
  return args.signer ?? browserEnsSigner({
    account: args.account,
    callbacks: args.callbacks,
    ...(args.session ? { session: args.session } : {}),
  })
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
  signer?: EnsSigner
}): Promise<{ txHash: string } | { skipped: true }> {
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const queryKeys = Array.from(new Set([
    ...Object.keys(args.records ?? {}),
    ...Object.keys(args.currentRecords ?? {}),
  ]))
  // Fresh reads decide what to write. A read that fails stops the update: falling back
  // to an older view could skip a record that still needs clearing.
  const freshCurrent: AgentEnsRecordState = queryKeys.length > 0
    ? await readEthagentTextRecords(args.fullName, queryKeys, {
        publicClient,
        ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
      })
    : {}
  const next = ensRecordWritesForUpdate({
    records: args.records,
    currentRecords: freshCurrent,
    clearRecords: args.clearRecords,
  })
  if (Object.keys(next).length === 0) {
    return { skipped: true }
  }
  const encoded = await encodeSetEnsip25TextRecord(args.fullName, next, { publicClient })
  const signer = signerFor({ signer: args.signer, account: args.ownerAddress, callbacks: args.callbacks, session: args.session })
  return sendEnsTransaction({
    signer,
    fullName: args.fullName,
    to: encoded.resolverAddress,
    data: encoded.data,
    purpose: args.purpose ?? 'update-ens-records',
    publicClient,
    callbacks: args.callbacks,
    action: 'ENS record update',
    ...(typeof args.tokenChainId === 'number' ? { tokenChainId: args.tokenChainId } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
    ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
  })
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
  signer?: EnsSigner
}): Promise<{ txHash: string } | null> {
  const encoded = encodeEnsRegistryTransaction(args.setup)
  if (!encoded) return null
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const purpose: WalletPurpose = args.setup.mode === 'simple' ? 'create-simple-ens-subdomain' : 'create-agent-ens-subdomain'
  const signer = signerFor({ signer: args.signer, account: args.setup.ownerAddress, callbacks: args.callbacks, session: args.session })
  return sendEnsTransaction({
    signer,
    fullName: args.setup.fullName,
    to: encoded.to,
    data: encoded.data,
    purpose,
    publicClient,
    callbacks: args.callbacks,
    action: 'ENS subdomain setup',
    ...(typeof args.tokenChainId === 'number' ? { tokenChainId: args.tokenChainId } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
    ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
  })
}

export async function runEnsSetupRecordsTransaction(args: {
  setup: EnsSetupPlan
  callbacks: EffectCallbacks
  publicClient?: PublicClient
  tokenChainId?: number
  session?: BrowserWalletSession
  flowId?: string
  flowStep?: number
  signer?: EnsSigner
}): Promise<{ txHash: string } | null> {
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const freshSetup = await refreshEnsSetupAgainstChain(args.setup, publicClient, args.callbacks.signal)
  const encoded = encodeEnsRecordsTransaction(freshSetup)
  if (!encoded) return null
  const purpose: WalletPurpose = freshSetup.mode === 'simple' ? 'set-simple-ens-records' : 'set-agent-ens-records'
  const signer = signerFor({ signer: args.signer, account: freshSetup.ownerAddress, callbacks: args.callbacks, session: args.session })
  return sendEnsTransaction({
    signer,
    fullName: freshSetup.fullName,
    to: encoded.to,
    data: encoded.data,
    purpose,
    publicClient,
    callbacks: args.callbacks,
    action: 'ENS record setup',
    ...(typeof args.tokenChainId === 'number' ? { tokenChainId: args.tokenChainId } : {}),
    ...(args.flowId ? { flowId: args.flowId } : {}),
    ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
  })
}

// Removes an agent subdomain: first clears the agent's text records on it, so nothing
// keeps pointing at the token if the parent later recreates the name, then removes the
// subdomain from its parent. Each step is preflighted and confirmed before the next.
export async function runDeleteEnsSubdomain(args: {
  plan: EnsSubdomainDeletePlan
  recordKeys: readonly string[]
  callbacks: EffectCallbacks
  publicClient?: PublicClient
  signer?: EnsSigner
  ownerAddress: Address
}): Promise<{ clearTxHash?: string; deleteTxHash: string }> {
  const publicClient = args.publicClient ?? createMainnetEnsPublicClient()
  const signer = signerFor({ signer: args.signer, account: args.ownerAddress, callbacks: args.callbacks })
  let clearTxHash: string | undefined
  const current = args.recordKeys.length > 0
    ? await readEthagentTextRecords(args.plan.fullName, args.recordKeys, {
        publicClient,
        ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
      })
    : {}
  if (Object.keys(current).length > 0) {
    const cleared = await runUpdateEnsRecords({
      fullName: args.plan.fullName,
      ownerAddress: signer.account,
      records: {},
      currentRecords: current,
      clearRecords: true,
      callbacks: args.callbacks,
      purpose: 'clear-ens-records',
      publicClient,
      signer,
    })
    if ('txHash' in cleared) clearTxHash = cleared.txHash
  }
  const deleted = await sendEnsTransaction({
    signer,
    fullName: args.plan.fullName,
    to: args.plan.transaction.to,
    data: args.plan.transaction.data,
    purpose: 'delete-ens-subdomain',
    publicClient,
    callbacks: args.callbacks,
    action: 'ENS subdomain deletion',
  })
  return { ...(clearTxHash ? { clearTxHash } : {}), deleteTxHash: deleted.txHash }
}

async function refreshEnsSetupAgainstChain(setup: EnsSetupPlan, publicClient: PublicClient, signal?: AbortSignal): Promise<EnsSetupPlan> {
  if (setup.registryAction !== 'none' && !setup.recordDiffs.length && !setup.addressRecord.changed) {
    return setup
  }
  const node = namehash(setup.fullName)
  const keys = Array.from(new Set(setup.recordDiffs.map(diff => diff.key)))
  const freshCurrent: AgentEnsRecordState = keys.length > 0
    ? await readEthagentTextRecords(setup.fullName, keys, { publicClient, ...(signal ? { signal } : {}) })
    : setup.currentRecords
  const freshAddress = await readAddressRecord(publicClient, setup.resolverAddress, node)
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
