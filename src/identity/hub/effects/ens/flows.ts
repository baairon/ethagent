import type { Address, PublicClient } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import type { AgentEnsRecordState, AgentEnsRecords } from '../../../ens/agentRecords.js'
import type { Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import {
  openBrowserWalletSession,
  type WalletPurpose,
} from '../../../wallet/browserWallet.js'
import type { ProfileUpdates, Step } from '../../identityHubReducer.js'
import type { EffectCallbacks, EnsClearProgress, EnsLinkProgress, EnsUpdateProgress } from '../types.js'
import {
  runEnsSetupRecordsTransaction,
  runEnsSetupRegistryTransaction,
  runUpdateEnsRecords,
} from './transactions.js'
import { runRebackupSigningInSession } from '../rebackup/runRebackup.js'

type EnsRecordsFlowArgs = {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  fullName: string
  ownerAddress: Address
  records: AgentEnsRecords
  currentRecords?: AgentEnsRecordState
  pinataJwt?: string
  publicClient?: PublicClient
}

async function runEnsRecordsThenSnapshot(args: {
  flowId: 'ens-clear' | 'ens-update' | 'ens-link'
  flow: EnsRecordsFlowArgs
  clearRecords: boolean
  recordsPurpose: WalletPurpose
  callbacks: EffectCallbacks
  reportProgress: (phase: 'records-tx' | 'records-confirming' | 'snapshot-sign' | 'snapshot-tx' | 'snapshot-confirming') => void
  preRecordsSteps?: number
  totalSteps: number
}): Promise<void> {
  const { flow } = args
  const session = await openBrowserWalletSession({ onReady: args.callbacks.onWalletReady })
  try {
    args.reportProgress('records-tx')
    const recordsStepIndex = (args.preRecordsSteps ?? 0) + 1
    await runUpdateEnsRecords({
      fullName: flow.fullName,
      ownerAddress: flow.ownerAddress,
      records: flow.records,
      ...(flow.currentRecords ? { currentRecords: flow.currentRecords } : {}),
      callbacks: args.callbacks,
      purpose: args.recordsPurpose,
      clearRecords: args.clearRecords,
      ...(flow.publicClient ? { publicClient: flow.publicClient } : {}),
      tokenChainId: flow.registry.chainId,
      session,
      flowId: args.flowId,
      flowStep: recordsStepIndex,
    })
    args.reportProgress('records-confirming')
    args.reportProgress('snapshot-sign')
    const snapshotStepIndex = recordsStepIndex + 1
    const nextEnsName = args.clearRecords ? '' : flow.fullName
    const profileUpdates: ProfileUpdates = { ensName: nextEnsName }
    const rebackupStep: Extract<Step, { kind: 'rebackup-signing' }> = {
      kind: 'rebackup-signing',
      identity: flow.identity,
      registry: flow.registry,
      profileUpdates,
      ...(flow.pinataJwt ? { pinataJwt: flow.pinataJwt } : {}),
    }
    args.reportProgress('snapshot-tx')
    await runRebackupSigningInSession(rebackupStep, args.callbacks, session, {
      flowId: args.flowId,
      flowStep: snapshotStepIndex,
    })
    args.reportProgress('snapshot-confirming')
  } finally {
    await session.close().catch(() => null)
    args.callbacks.onWalletReady(null)
  }
}

export async function runEnsUnlinkFlow(
  step: Extract<Step, { kind: 'ens-clear-flow-running' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  await runEnsRecordsThenSnapshot({
    flowId: 'ens-clear',
    clearRecords: true,
    recordsPurpose: 'clear-ens-records',
    flow: {
      identity: step.identity,
      registry: step.registry,
      fullName: step.fullName,
      ownerAddress: step.ownerAddress,
      records: step.records,
      ...(step.currentRecords ? { currentRecords: step.currentRecords } : {}),
      ...(step.pinataJwt ? { pinataJwt: step.pinataJwt } : {}),
    },
    callbacks,
    reportProgress: phase => callbacks.onEnsClearProgress?.({ phase, label: ensClearLabelFor(phase) }),
    totalSteps: 2,
  })
  callbacks.onEnsClearProgress?.(null)
}

export async function runEnsUpdateFlow(
  step: Extract<Step, { kind: 'ens-update-flow-running' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  await runEnsRecordsThenSnapshot({
    flowId: 'ens-update',
    clearRecords: false,
    recordsPurpose: 'update-ens-records',
    flow: {
      identity: step.identity,
      registry: step.registry,
      fullName: step.fullName,
      ownerAddress: step.ownerAddress,
      records: step.records,
      ...(step.currentRecords ? { currentRecords: step.currentRecords } : {}),
      ...(step.pinataJwt ? { pinataJwt: step.pinataJwt } : {}),
    },
    callbacks,
    reportProgress: phase => callbacks.onEnsUpdateProgress?.({ phase, label: ensUpdateLabelFor(phase) }),
    totalSteps: 2,
  })
  callbacks.onEnsUpdateProgress?.(null)
}

function ensClearLabelFor(phase: EnsClearProgress['phase']): string {
  switch (phase) {
    case 'records-tx': return 'Clearing ENS records on Ethereum Mainnet...'
    case 'records-confirming': return 'Waiting for ENS clear confirmation...'
    case 'snapshot-sign': return 'Sign to save the cleared snapshot...'
    case 'snapshot-tx': return 'Publishing cleared snapshot to the agent token URI...'
    case 'snapshot-confirming': return 'Waiting for snapshot publish confirmation...'
  }
}

function ensUpdateLabelFor(phase: EnsUpdateProgress['phase']): string {
  switch (phase) {
    case 'records-tx': return 'Updating ENS records on Ethereum Mainnet...'
    case 'records-confirming': return 'Waiting for ENS records confirmation...'
    case 'snapshot-sign': return 'Sign to save the updated snapshot...'
    case 'snapshot-tx': return 'Publishing updated snapshot to the agent token URI...'
    case 'snapshot-confirming': return 'Waiting for snapshot publish confirmation...'
  }
}

function ensLinkLabelFor(phase: EnsLinkProgress['phase']): string {
  switch (phase) {
    case 'registry-tx': return 'Creating ENS subdomain on Ethereum Mainnet...'
    case 'registry-confirming': return 'Waiting for subdomain creation confirmation...'
    case 'records-tx': return 'Setting ENS records on Ethereum Mainnet...'
    case 'records-confirming': return 'Waiting for ENS records confirmation...'
    case 'snapshot-sign': return 'Sign to save the linked snapshot...'
    case 'snapshot-tx': return 'Publishing linked snapshot to the agent token URI...'
    case 'snapshot-confirming': return 'Waiting for snapshot publish confirmation...'
  }
}

export async function runEnsLinkFlow(
  step: Extract<Step, { kind: 'ens-link-flow-running' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const session = await openBrowserWalletSession({ onReady: callbacks.onWalletReady })
  const report = (phase: EnsLinkProgress['phase']): void => {
    callbacks.onEnsLinkProgress?.({ phase, label: ensLinkLabelFor(phase) })
  }
  try {
    let stepIndex = 0
    const willRunRegistry = step.setup.registryAction !== 'none'
    if (willRunRegistry) {
      stepIndex += 1
      report('registry-tx')
      await runEnsSetupRegistryTransaction({
        setup: step.setup,
        callbacks,
        tokenChainId: step.registry.chainId,
        session,
        flowId: 'ens-link',
        flowStep: stepIndex,
      })
      report('registry-confirming')
    }
    stepIndex += 1
    report('records-tx')
    await runEnsSetupRecordsTransaction({
      setup: step.setup,
      callbacks,
      tokenChainId: step.registry.chainId,
      session,
      flowId: 'ens-link',
      flowStep: stepIndex,
    })
    report('records-confirming')
    stepIndex += 1
    report('snapshot-sign')
    const profileUpdates: ProfileUpdates = { ensName: step.setup.fullName }
    const rebackupStep: Extract<Step, { kind: 'rebackup-signing' }> = {
      kind: 'rebackup-signing',
      identity: step.identity,
      registry: step.registry,
      profileUpdates,
      ...(step.pinataJwt ? { pinataJwt: step.pinataJwt } : {}),
    }
    report('snapshot-tx')
    await runRebackupSigningInSession(rebackupStep, callbacks, session, {
      flowId: 'ens-link',
      flowStep: stepIndex,
    })
    report('snapshot-confirming')
  } finally {
    await session.close().catch(() => null)
    callbacks.onWalletReady(null)
    callbacks.onEnsLinkProgress?.(null)
  }
}
