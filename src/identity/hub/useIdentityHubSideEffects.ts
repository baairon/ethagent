import { useEffect } from 'react'
import type { EthagentConfig } from '../../storage/config.js'
import { setTokenIdentity } from '../../storage/identity.js'
import { isRegistrationPreflightError, pinataErrorText } from './shared/model/errors.js'
import type { ProfileUpdates, Step } from './identityHubReducer.js'
import {
  runCreatePreflight,
  runCreateSigning,
} from './create/effects.js'
import {
  runRebackupSigning,
} from './continuity/effects.js'
import {
  runPublicProfileSigning,
} from './profile/effects.js'
import {
  runTokenTransferSigning,
} from './transfer/effects.js'
import {
  runEnsSetupRecordsTransaction,
  runEnsSetupRegistryTransaction,
  runUpdateEnsRecords,
} from './ens/index.js'
import {
  runRecoveryRefetch,
} from './restore/index.js'
import type { EffectCallbacks } from './shared/effects/types.js'
import { useRestoreEffects } from './restore/useRestoreEffects.js'
import {
  isStorageError,
  isWalletCancelled,
  waitForMinimumBusyTime,
} from './shared/utils.js'

type TriggerRebackup = (
  backStep: Step,
  profileUpdates?: ProfileUpdates,
  options?: { vaultAddress?: `0x${string}`; useVault?: boolean },
) => void

type UseIdentityHubSideEffectsArgs = {
  step: Step
  config: EthagentConfig | undefined
  callbacks: EffectCallbacks
  setStep: (step: Step) => void
  handleStepError: (err: unknown, backStep: Step, softCancel?: Step) => void
  triggerRebackup: TriggerRebackup
  setContinuityReady: (ready: boolean) => void
  onConfigChange?: (config: EthagentConfig) => void
}

export function useIdentityHubSideEffects({
  step,
  config,
  callbacks,
  setStep,
  handleStepError,
  triggerRebackup,
  setContinuityReady,
  onConfigChange,
}: UseIdentityHubSideEffectsArgs): void {
  useEffect(() => {
    if (step.kind !== 'rebackup-start') return
    triggerRebackup(step.back)
  }, [step])

  useEffect(() => {
    if (step.kind !== 'create-preflight') return
    let cancelled = false
    const startedAt = Date.now()
    runCreatePreflight(step, config, callbacks)
      .catch(async (err: unknown) => {
        await waitForMinimumBusyTime(startedAt)
        if (!cancelled) handleStepError(err, { kind: 'create-network', name: step.name, description: step.description })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'create-signing') return
    let cancelled = false
    const backStep: Step = { kind: 'create-network', name: step.name, description: step.description }
    runCreateSigning(step, callbacks)
      .catch((err: unknown) => {
        if (cancelled) return
        if (isRegistrationPreflightError(err)) {
          handleStepError(err, backStep)
          return
        }
        if (isStorageError(err)) {
          setStep({
            kind: 'create-storage',
            name: step.name,
            description: step.description,
            registry: step.registry,
            custodyMode: step.custodyMode,
            error: pinataErrorText(err),
            pinataJwt: step.pinataJwt,
          })
          return
        }
        handleStepError(err, backStep)
      })
    return () => { cancelled = true }
  }, [step])

  useRestoreEffects({ step, config, callbacks, handleStepError })

  useEffect(() => {
    if (step.kind !== 'rebackup-signing') return
    let cancelled = false
    runRebackupSigning(step, callbacks)
      .catch((err: unknown) => {
        if (cancelled) return
        if (isStorageError(err)) {
          setStep({
            kind: 'rebackup-storage',
            identity: step.identity,
            registry: step.registry,
            error: pinataErrorText(err),
            pinataJwt: step.pinataJwt,
            profileUpdates: step.profileUpdates,
            returnTo: step.returnTo,
            walletPurpose: step.walletPurpose,
          })
          return
        }
        handleStepError(err, step.returnTo ?? { kind: 'menu' })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'public-profile-signing') return
    let cancelled = false
    runPublicProfileSigning(step, callbacks)
      .catch((err: unknown) => {
        if (cancelled) return
        if (isStorageError(err)) {
          setStep({
            kind: 'public-profile-storage',
            identity: step.identity,
            registry: step.registry,
            error: pinataErrorText(err),
            pinataJwt: step.pinataJwt,
            profileUpdates: step.profileUpdates,
            returnTo: step.returnTo,
            ...(step.vaultAddress ? { vaultAddress: step.vaultAddress } : {}),
          })
          return
        }
        handleStepError(err, step.returnTo ?? { kind: 'continuity-public' })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'token-transfer-signing') return
    let cancelled = false
    runTokenTransferSigning(step, callbacks)
      .then(async result => {
        if (cancelled) return
        if (config) {
          const nextConfig = await setTokenIdentity(config, result.identity)
          onConfigChange?.(nextConfig)
        }
        setStep({
          kind: 'token-transfer-ready',
          identity: result.identity,
          registry: step.registry,
          targetHandle: step.targetHandle,
          targetAddress: step.targetAddress,
          snapshotCid: result.snapshotCid,
          txHash: result.txHash,
          returnTo: step.returnTo,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isStorageError(err)) {
          setStep({
            kind: 'token-transfer-storage',
            identity: step.identity,
            registry: step.registry,
            targetHandle: step.targetHandle,
            targetAddress: step.targetAddress,
            error: pinataErrorText(err),
            pinataJwt: step.pinataJwt,
            returnTo: step.returnTo,
          })
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        const targetReturn: Step = {
          kind: 'token-transfer-target',
          identity: step.identity,
          registry: step.registry,
          previousTarget: step.targetHandle,
          ...(step.returnTo ? { returnTo: step.returnTo } : {}),
          ...(isWalletCancelled(err) ? {} : { error: message }),
        }
        if (isWalletCancelled(err)) {
          setStep(targetReturn)
          return
        }
        handleStepError(err, targetReturn)
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'recovery-refetching') return
    let cancelled = false
    runRecoveryRefetch(step.identity, step.registry, callbacks)
      .then(() => {
        if (!cancelled) setContinuityReady(true)
      })
      .catch((err: unknown) => {
        if (!cancelled) handleStepError(err, { kind: 'menu' })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'ens-records-tx') return
    let cancelled = false
    const ownerAddress = (step.ownerAddress ?? step.identity.ownerAddress ?? step.identity.address) as `0x${string}`
    runUpdateEnsRecords({
      fullName: step.fullName,
      ownerAddress,
      records: step.records,
      currentRecords: step.currentRecords,
      callbacks,
      clearRecords: step.clearRecords,
      purpose: step.clearRecords ? 'clear-ens-records' : undefined,
      tokenChainId: step.registry.chainId,
    })
      .then(() => {
        if (cancelled) return
        triggerRebackup(step.returnTo ?? { kind: 'menu' }, step.clearRecords ? { ensName: '' } : { ensName: step.fullName })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        handleStepError(err, { kind: 'edit-profile-ens', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'ens-setup-registry-tx') return
    let cancelled = false
    runEnsSetupRegistryTransaction({ setup: step.setup, callbacks, tokenChainId: step.registry.chainId })
      .then(result => {
        if (cancelled) return
        setStep({
          kind: 'ens-setup-records-tx',
          identity: step.identity,
          registry: step.registry,
          setup: step.setup,
          returnTo: step.returnTo,
          ...(result ? { registryTxHash: result.txHash } : {}),
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        handleStepError(err, {
          kind: 'edit-profile-ens',
          identity: step.identity,
          registry: step.registry,
          returnTo: step.returnTo,
          ...(step.setup.mode === 'advanced' ? { initialView: 'advanced' as const } : {}),
        })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'ens-setup-records-tx') return
    let cancelled = false
    runEnsSetupRecordsTransaction({ setup: step.setup, callbacks, tokenChainId: step.registry.chainId })
      .then(() => {
        if (cancelled) return
        const ensUpdates = step.setup.mode === 'advanced'
          ? {
              ensName: step.setup.fullName,
              custodyMode: 'advanced' as const,
              ownerAddress: step.setup.ownerAddress,
              approvedOperatorWallets: [step.setup.operatorAddress],
              activeOperatorAddress: step.setup.operatorAddress,
            }
          : {
              ensName: step.setup.fullName,
              custodyMode: 'simple' as const,
            }
        triggerRebackup(step.returnTo ?? { kind: 'menu' }, ensUpdates)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        handleStepError(err, {
          kind: 'edit-profile-ens',
          identity: step.identity,
          registry: step.registry,
          returnTo: step.returnTo,
          ...(step.setup.mode === 'advanced' ? { initialView: 'advanced' as const } : {}),
        })
      })
    return () => { cancelled = true }
  }, [step])
}
