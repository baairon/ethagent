import { useEffect, useReducer, useState } from 'react'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { defaultModelFor } from '../../storage/config.js'
import { setTokenIdentity } from '../../storage/identity.js'
import type { BrowserWalletReady } from '../wallet/browserWallet.js'
import { registryConfigFromConfig } from '../registry/registryConfig.js'
import type { Erc8004RegistryConfig } from '../registry/erc8004.js'
import {
  hasPinataJwt,
} from '../storage/pinataJwt.js'
import {
  assertTokenNotInVault,
  TokenInVaultError,
} from './custody/preflight.js'
import {
  runPublicProfilePreflight,
} from './profile/effects.js'
import {
  runRebackupPreflight,
} from './continuity/effects.js'
import type {
  EffectCallbacks,
  IdentityCompletionSource,
  RestoreProgress,
  TokenTransferProgress,
} from './shared/effects/types.js'
import { resolveVaultAddress } from './custody/transactions.js'
import { useCustodyFlow } from './custody/useCustodyFlow.js'
import { identityHubErrorView } from './shared/model/errors.js'
import { readCustodyMode } from './custody/state.js'
import { selectEnsStatus } from './ens/state.js'
import { identityHubReducer, type ProfileUpdates, type Step } from './identityHubReducer.js'
import type { IdentityHubProps } from './types.js'
import {
  capitalizeFeedbackMessage,
  initialStepForAction,
  isWalletCancelled,
} from './shared/utils.js'
import {
  preflightTokenOwnership,
  useAgentReconciliation,
} from './shared/reconciliation/index.js'
import { useIdentityHubContinuity } from './useIdentityHubContinuity.js'
import { useIdentityHubSideEffects } from './useIdentityHubSideEffects.js'

export function useIdentityHubController({
  mode,
  config,
  initialAction,
  onComplete,
  onConfigChange,
}: IdentityHubProps) {
  const [firstRunIdentity, setFirstRunIdentity] = useState<EthagentIdentity | null>(null)
  const identity = config?.identity ?? firstRunIdentity ?? undefined
  const { reconciliation, refresh: refreshReconciliation } = useAgentReconciliation(config ?? null)
  const [step, dispatch] = useReducer(identityHubReducer, initialStepForAction(initialAction, config))
  const [walletSession, setWalletSession] = useState<BrowserWalletReady | null>(null)
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null)
  const [tokenTransferProgress, setTokenTransferProgress] = useState<TokenTransferProgress | null>(null)
  const [jwtSaved, setJwtSaved] = useState<boolean>(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const canRebackup = Boolean(identity?.agentId && (identity?.identityRegistryAddress || config?.erc8004?.identityRegistryAddress))

  const setStep = (s: Step) => dispatch({ type: 'setStep', step: s })
  const back = () => dispatch({ type: 'back', from: step })
  const closeHub = () => onComplete(mode === 'first-run' ? { kind: 'skip' } : { kind: 'cancel' })

  useEffect(() => { setWalletSession(null) }, [step.kind])
  useEffect(() => {
    if (step.kind !== 'restore-authorizing') setRestoreProgress(null)
  }, [step.kind])
  useEffect(() => {
    if (step.kind !== 'token-transfer-signing') setTokenTransferProgress(null)
  }, [step.kind])

  useEffect(() => {
    let cancelled = false
    hasPinataJwt().then(v => { if (!cancelled) setJwtSaved(v) }).catch(() => {})
    return () => { cancelled = true }
  }, [step.kind])

  useEffect(() => { setCopyNotice(null) }, [step.kind])
  useEffect(() => {
    if (!copyNotice) return
    const timer = setTimeout(() => setCopyNotice(null), 2500)
    return () => clearTimeout(timer)
  }, [copyNotice])

  const registryFromIdentity = (nextIdentity: EthagentIdentity): Erc8004RegistryConfig | null => {
    if (!nextIdentity.chainId || !nextIdentity.identityRegistryAddress) return null
    return {
      chainId: nextIdentity.chainId,
      rpcUrl: nextIdentity.rpcUrl ?? '',
      identityRegistryAddress: nextIdentity.identityRegistryAddress as `0x${string}`,
    }
  }

  const resolveRegistryForIdentity = (target: EthagentIdentity): Erc8004RegistryConfig | null => {
    const resolution = registryConfigFromConfig(config)
    if (target.chainId && target.identityRegistryAddress) {
      return {
        chainId: target.chainId,
        rpcUrl: target.rpcUrl ?? resolution.defaultRpcUrl,
        identityRegistryAddress: target.identityRegistryAddress as `0x${string}`,
      }
    }
    if (resolution.config) return resolution.config
    return null
  }

  const completeTokenIdentity = async (nextIdentity: EthagentIdentity, message: string, source?: IdentityCompletionSource): Promise<void> => {
    if (mode === 'first-run' || !config) {
      setFirstRunIdentity(nextIdentity)
      const registry = registryFromIdentity(nextIdentity)
      const custodyMode = readCustodyMode(nextIdentity.state)

      if (source === 'create' && custodyMode === 'advanced' && registry) {
        const seedConfig: EthagentConfig = {
          version: 1,
          provider: 'llamacpp',
          model: defaultModelFor('llamacpp'),
          firstRunAt: new Date().toISOString(),
          identity: { ...nextIdentity, source: 'erc8004' },
          erc8004: {
            chainId: registry.chainId,
            rpcUrl: registry.rpcUrl,
            identityRegistryAddress: registry.identityRegistryAddress,
          },
        }
        const persisted = await setTokenIdentity(seedConfig, nextIdentity)
        onConfigChange?.(persisted)
        const ownerAddress = (nextIdentity.ownerAddress ?? nextIdentity.address) as `0x${string}`
        const profileUpdates: ProfileUpdates = {
          custodyMode: 'advanced',
          ownerAddress: ownerAddress,
          bumpRestoreAccessEpoch: true,
          custodyPhase: 'switch-advanced',
        }
        setStep({
          kind: 'custody-vault-deploy-tx',
          identity: nextIdentity,
          registry,
          profileUpdates,
          returnTo: { kind: 'menu' },
        })
        return
      }

      const ensStatus = selectEnsStatus(nextIdentity)
      if (registry && ensStatus.kind === 'none') {
        setStep({ kind: 'first-run-ens-prompt', identity: nextIdentity, registry })
        return
      }
      onComplete({ kind: 'token', identity: nextIdentity })
      return
    }
    const nextConfig = await setTokenIdentity(config, nextIdentity)
    const switchPhase = step.kind === 'rebackup-signing' || step.kind === 'rebackup-storage'
      ? step.profileUpdates?.custodyPhase
      : undefined
    if (switchPhase === 'switch-advanced' || switchPhase === 'switch-simple') {
      onConfigChange?.(nextConfig)
      const registry = resolveRegistryForIdentity(nextIdentity)
      if (registry) {
        const vaultAddress = step.kind === 'rebackup-signing' || step.kind === 'rebackup-storage'
          ? step.vaultAddress
          : undefined
        if (switchPhase === 'switch-advanced') {
          setStep({
            kind: 'custody-advanced-done',
            identity: nextIdentity,
            registry,
            ...(vaultAddress ? { vaultAddress } : {}),
            returnTo: { kind: 'menu' },
          })
        } else {
          setStep({
            kind: 'custody-simple-done',
            identity: nextIdentity,
            registry,
            returnTo: { kind: 'menu' },
          })
        }
        return
      }
    }
    onComplete({ kind: 'updated', config: nextConfig, message: capitalizeFeedbackMessage(message) })
  }

  const callbacks: EffectCallbacks = {
    onStep: setStep,
    onWalletReady: setWalletSession,
    onIdentityComplete: completeTokenIdentity,
    onRestoreProgress: setRestoreProgress,
    onTokenTransferProgress: setTokenTransferProgress,
  }

  const handleStepError = (err: unknown, backStep: Step, softCancel: Step = backStep): void => {
    if (isWalletCancelled(err)) {
      setStep(softCancel)
      return
    }
    setStep({ kind: 'error', error: identityHubErrorView(err), back: backStep })
  }

  const guardOwnership = async (
    target: EthagentIdentity,
    registry: Erc8004RegistryConfig,
    requiredRole: 'token-holder' | 'vault-level-owner',
    backStep: Step,
  ): Promise<boolean> => {
    const result = await preflightTokenOwnership({
      identity: target,
      registry,
      operatorVaults: config?.erc8004?.operatorVaults,
      requiredRole,
    })
    if (result.ok) return true
    if (result.reason === 'lookup-failed') {
      return true
    }
    setStep({
      kind: 'identity-unlinked',
      identity: target,
      registry,
      ...(result.onChainOwner ? { onChainOwner: result.onChainOwner } : {}),
      back: backStep,
    })
    return false
  }

  const triggerRebackup = (
    backStep: Step,
    profileUpdates?: ProfileUpdates,
    options?: { vaultAddress?: `0x${string}`; useVault?: boolean },
  ): void => {
    if (!identity) return
    const registry = resolveRegistryForIdentity(identity)
    if (!registry) {
      handleStepError(new Error('no agent registry configured for this identity'), backStep)
      return
    }
    const vaultAddress = options?.useVault === false
      ? undefined
      : options?.vaultAddress ?? resolveVaultAddress(identity, config?.erc8004?.operatorVaults)
    ;(async () => {
      const role: 'token-holder' | 'vault-level-owner' = vaultAddress ? 'vault-level-owner' : 'token-holder'
      const allowed = await guardOwnership(identity, registry, role, backStep)
      if (!allowed) return
      runRebackupPreflight(identity, registry, callbacks, profileUpdates, backStep, undefined, vaultAddress)
        .catch((err: unknown) => handleStepError(err, backStep))
    })()
  }

  const triggerPublicProfileSave = (backStep: Step, profileUpdates: ProfileUpdates): void => {
    if (!identity) return
    const registry = resolveRegistryForIdentity(identity)
    if (!registry) {
      handleStepError(new Error('no agent registry configured for this identity'), backStep)
      return
    }
    ;(async () => {
      const vaultAddress = resolveVaultAddress(identity, config?.erc8004?.operatorVaults)
      const allowed = await guardOwnership(identity, registry, 'vault-level-owner', backStep)
      if (!allowed) return
      runPublicProfilePreflight(identity, registry, callbacks, profileUpdates, backStep, vaultAddress)
        .catch((err: unknown) => handleStepError(err, backStep))
    })()
  }

  const custodyFlow = useCustodyFlow({
    config,
    step,
    setStep,
    callbacks,
    walletSession,
    handleStepError,
    guardOwnership,
    triggerRebackup,
    refreshReconciliation,
    ...(onConfigChange ? { onConfigChange } : {}),
  })

  const continuity = useIdentityHubContinuity({
    identity,
    step,
    setStep,
    handleStepError,
  })

  useIdentityHubSideEffects({
    step,
    config,
    callbacks,
    setStep,
    handleStepError,
    triggerRebackup,
    setContinuityReady: continuity.setContinuityReady,
    ...(onConfigChange ? { onConfigChange } : {}),
  })

  const finishFirstRunIdentity = (): void => {
    if (!firstRunIdentity) {
      onComplete({ kind: 'skip' })
      return
    }
    onComplete({ kind: 'token', identity: firstRunIdentity })
  }

  const openEnsEdit = (backStep: Step): void => {
    if (!identity) return
    if (!identity.agentId) {
      handleStepError(new Error('Create an agent first to link an ENS name.'), backStep)
      return
    }
    const registry = resolveRegistryForIdentity(identity)
    if (!registry) {
      handleStepError(new Error('no agent registry configured for this identity'), backStep)
      return
    }
    setStep({ kind: 'edit-profile-ens', identity, registry, returnTo: backStep })
  }

  const openPublicProfileEdit = (backStep: Step): void => {
    if (!identity) return
    const registry = resolveRegistryForIdentity(identity)
    if (!registry) {
      handleStepError(new Error('no agent registry configured for this identity'), backStep)
      return
    }
    setStep({ kind: 'edit-profile-name', identity, registry, returnTo: backStep })
  }

  const openTokenTransferFlow = async (): Promise<void> => {
    if (!identity) return
    if (!identity.agentId) {
      handleStepError(new Error('Create an agent first to prepare a token transfer.'), { kind: 'menu' })
      return
    }
    const registry = resolveRegistryForIdentity(identity)
    if (!registry) {
      handleStepError(new Error('no agent registry configured for this identity'), { kind: 'menu' })
      return
    }
    setStep({ kind: 'busy', label: 'Checking token custody...' })
    try {
      await assertTokenNotInVault({ identity, registry, operatorVaults: config?.erc8004?.operatorVaults })
    } catch (err: unknown) {
      if (err instanceof TokenInVaultError) {
        setStep({ kind: 'custody-model', identity, registry, returnTo: { kind: 'menu' }, notice: err.message })
        return
      }
      handleStepError(err, { kind: 'menu' })
      return
    }
    setStep({ kind: 'token-transfer-target', identity, registry })
  }

  return {
    mode,
    config,
    onComplete,
    onConfigChange,
    identity,
    reconciliation,
    step,
    walletSession,
    restoreProgress,
    tokenTransferProgress,
    jwtSaved,
    copyNotice,
    canRebackup,
    callbacks,
    custodyFlow,
    continuityReady: continuity.continuityReady,
    workingStatus: continuity.workingStatus,
    setStep,
    back,
    closeHub,
    setWalletSession,
    setJwtSaved,
    setCopyNotice,
    handleStepError,
    resolveRegistryForIdentity,
    triggerRebackup,
    triggerPublicProfileSave,
    finishFirstRunIdentity,
    openEnsEdit,
    openTokenTransferFlow,
    openPublicProfileEdit,
    openContinuityFile: continuity.openContinuityFile,
    openSkillFile: continuity.openSkillFile,
    openSkillsFolder: continuity.openSkillsFolder,
    createSkill: continuity.createSkill,
    deleteSkill: continuity.deleteSkill,
    setSkillVisibility: continuity.setSkillVisibility,
  }
}

export type IdentityHubController = ReturnType<typeof useIdentityHubController>
