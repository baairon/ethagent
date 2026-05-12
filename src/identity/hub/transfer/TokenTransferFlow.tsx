import React from 'react'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import { supportedErc8004ChainForId } from '../../registry/erc8004.js'
import {
  runTokenTransferStorageSubmit,
  runTokenTransferTargetSubmit,
} from './effects.js'
import type {
  EffectCallbacks,
  TokenTransferProgress,
} from '../shared/effects/types.js'
import type { Step } from '../identityHubReducer.js'
import { BusyScreen } from '../shared/components/BusyScreen.js'
import { RebackupStorageScreen } from '../continuity/RebackupStorageScreen.js'
import {
  TokenTransferReadyScreen,
  TokenTransferSigningScreen,
  TokenTransferTargetScreen,
} from './TokenTransferScreens.js'

type TokenTransferStep = Extract<Step, {
  kind:
    | 'token-transfer-target'
    | 'token-transfer-resolving'
    | 'token-transfer-storage'
    | 'token-transfer-signing'
    | 'token-transfer-ready'
}>

type TokenTransferFlowProps = {
  step: TokenTransferStep
  callbacks: EffectCallbacks
  footer: React.ReactNode
  progress: TokenTransferProgress | null
  walletSession: BrowserWalletReady | null
  onSetStep: (step: Step) => void
  onBack: () => void
}

export function isTokenTransferStep(step: Step): step is TokenTransferStep {
  return step.kind === 'token-transfer-target'
    || step.kind === 'token-transfer-resolving'
    || step.kind === 'token-transfer-storage'
    || step.kind === 'token-transfer-signing'
    || step.kind === 'token-transfer-ready'
}

export const TokenTransferFlow: React.FC<TokenTransferFlowProps> = ({
  step,
  callbacks,
  footer,
  progress,
  walletSession,
  onSetStep,
  onBack,
}) => {
  const resolveAbortRef = React.useRef<AbortController | null>(null)
  const tokenNetworkLabel = networkLabelForChainId(step.registry.chainId)
  const readyBackHint = tokenTransferBackHint(step.returnTo)

  if (step.kind === 'token-transfer-target') {
    return (
      <TokenTransferTargetScreen
        identity={step.identity}
        tokenNetworkLabel={tokenNetworkLabel}
        error={step.error}
        initialValue={step.previousTarget}
        onSubmit={async value => {
          resolveAbortRef.current?.abort()
          const controller = new AbortController()
          resolveAbortRef.current = controller
          try {
            await runTokenTransferTargetSubmit(value, step, callbacks, { signal: controller.signal })
          } catch (err: unknown) {
            if (controller.signal.aborted) return
            onSetStep({ ...step, error: (err as Error).message })
          } finally {
            if (resolveAbortRef.current === controller) resolveAbortRef.current = null
          }
        }}
        onBack={onBack}
      />
    )
  }

  if (step.kind === 'token-transfer-resolving') {
    return (
      <BusyScreen
        title="Resolve Receiver Wallet"
        subtitle={`Resolving ${step.targetHandle} before preparing the transfer snapshot.`}
        label="checking ens or address..."
        onCancel={() => {
          resolveAbortRef.current?.abort()
          resolveAbortRef.current = null
          onBack()
        }}
      />
    )
  }

  if (step.kind === 'token-transfer-storage') {
    return (
      <RebackupStorageScreen
        step={{
          kind: 'rebackup-storage',
          identity: step.identity,
          registry: step.registry,
          error: step.error,
          pinataJwt: step.pinataJwt,
        }}
        footer={footer}
        title="Connect IPFS Storage"
        subtitle="Save a Pinata JWT so ethagent can pin the transfer snapshot to IPFS."
        onSubmit={async input => {
          try {
            await runTokenTransferStorageSubmit(input, step, callbacks)
          } catch (err: unknown) {
            onSetStep({ ...step, error: (err as Error).message })
          }
        }}
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'token-transfer-signing') {
    return (
      <TokenTransferSigningScreen
        identity={step.identity}
        tokenNetworkLabel={tokenNetworkLabel}
        targetHandle={step.targetHandle}
        targetAddress={step.targetAddress}
        progress={progress}
        walletSession={walletSession}
        onCancel={onBack}
      />
    )
  }

  return (
    <TokenTransferReadyScreen
      identity={step.identity}
      tokenNetworkLabel={tokenNetworkLabel}
      targetHandle={step.targetHandle}
      targetAddress={step.targetAddress}
      snapshotCid={step.snapshotCid}
      txHash={step.txHash}
      footer={footer}
      backHint={readyBackHint}
      onBack={onBack}
    />
  )
}

function networkLabelForChainId(chainId: number): string {
  return supportedErc8004ChainForId(chainId)?.name ?? `Chain ${chainId}`
}

function tokenTransferBackHint(returnTo: Step | undefined): string {
  if (returnTo?.kind === 'edit-profile-ens') return 'Return to ENS setup'
  return 'Return to Identity Hub menu'
}
