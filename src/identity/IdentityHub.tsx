import React, { useEffect, useReducer, useState } from 'react'
import { Text } from 'ink'
import { theme } from '../ui/theme.js'
import { type EthagentConfig, type EthagentIdentity, type SelectableNetwork } from '../storage/config.js'
import { clearIdentity, setTokenIdentity } from '../storage/identity.js'
import { copyToClipboard } from '../utils/clipboard.js'
import { DEFAULT_IPFS_API_URL } from './ipfs.js'
import { hasPinataJwt, clearPinataJwt, savePinataJwt } from './pinataJwt.js'
import { registryConfigFromConfig } from './registryConfig.js'
import { identityHubErrorView, isRegistrationPreflightError, pinataErrorText } from './identityHubModel.js'
import { identityHubReducer, type ProfileUpdates, type Step } from './identityHubReducer.js'
import {
  runCreatePreflight,
  runCreateSigning,
  runRestoreConnectWallet,
  runRestoreDiscover,
  runRestoreTokenIdSubmit,
  runRestoreFetch,
  runRestoreAuthorize,
  runRegistrySubmit,
  runRestoreRegistrySubmit,
  runStorageSubmit,
  runRebackupPreflight,
  runRebackupSigning,
  runRebackupStorageSubmit,
  isAgentTokenIdRequiredError,
  type EffectCallbacks,
} from './identityHubEffects.js'
import type { BrowserWalletReady } from './browserWallet.js'
import { MenuScreen } from './screens/MenuScreen.js'
import { CreateFlow } from './screens/CreateFlow.js'
import { RestoreFlow } from './screens/RestoreFlow.js'
import { NetworkScreen } from './screens/NetworkScreen.js'
import { DetailsScreen } from './screens/DetailsScreen.js'
import { ErrorScreen } from './screens/ErrorScreen.js'
import { WalletApprovalScreen } from './screens/WalletApprovalScreen.js'
import { RebackupStorageScreen } from './screens/RebackupStorageScreen.js'
import { BusyScreen } from './screens/BusyScreen.js'
import { EditProfileFlow } from './screens/EditProfileFlow.js'
import { ForgetIdentityScreen } from './screens/ForgetIdentityScreen.js'
import { StorageCredentialScreen } from './screens/StorageCredentialScreen.js'
import { chainIdForNetwork, erc8004ConfigForSupportedChain, type Erc8004RegistryConfig } from './erc8004.js'

const MIN_BUSY_ERROR_MS = 2000

function isWalletCancelled(err: unknown): boolean {
  if (!err) return false
  const message = err instanceof Error ? err.message : String(err)
  return /browser wallet request was cancelled/i.test(message)
    || /user rejected/i.test(message)
}

function isStorageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /pinata|ipfs|pin|storage/i.test(message)
}

function waitForMinimumBusyTime(startedAt: number): Promise<void> {
  const remaining = MIN_BUSY_ERROR_MS - (Date.now() - startedAt)
  return remaining > 0
    ? new Promise(resolve => setTimeout(resolve, remaining))
    : Promise.resolve()
}

export type IdentityHubResult =
  | { kind: 'token'; identity: EthagentIdentity }
  | { kind: 'updated'; config: EthagentConfig; message: string }
  | { kind: 'skip' }
  | { kind: 'cancel' }

type IdentityHubProps = {
  mode: 'first-run' | 'manage'
  config?: EthagentConfig
  cwd?: string
  initialAction?: IdentityHubInitialAction
  onComplete: (result: IdentityHubResult) => void
  onConfigChange?: (config: EthagentConfig) => void
}

export type IdentityHubInitialAction = 'create' | 'load'

export const IdentityHub: React.FC<IdentityHubProps> = ({ mode, config, initialAction, onComplete, onConfigChange }) => {
  const identity = config?.identity
  const [step, dispatch] = useReducer(identityHubReducer, initialStepForAction(initialAction, config))
  const [walletSession, setWalletSession] = useState<BrowserWalletReady | null>(null)
  const [jwtSaved, setJwtSaved] = useState<boolean>(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const canRebackup = Boolean(identity?.agentId && (identity?.identityRegistryAddress || config?.erc8004?.identityRegistryAddress))

  const setStep = (s: Step) => dispatch({ type: 'preflightResolved', step: s })
  const back = () => dispatch({ type: 'back', from: step })

  useEffect(() => { setWalletSession(null) }, [step.kind])

  useEffect(() => {
    let cancelled = false
    hasPinataJwt().then(v => { if (!cancelled) setJwtSaved(v) }).catch(() => {})
    return () => { cancelled = true }
  }, [step.kind])

  useEffect(() => { setCopyNotice(null) }, [step.kind])

  const completeTokenIdentity = async (nextIdentity: EthagentIdentity, message: string): Promise<void> => {
    if (mode === 'first-run' || !config) {
      onComplete({ kind: 'token', identity: nextIdentity })
      return
    }
    const nextConfig = await setTokenIdentity(config, nextIdentity)
    onComplete({ kind: 'updated', config: nextConfig, message })
  }

  const callbacks: EffectCallbacks = {
    onStep: setStep,
    onWalletReady: setWalletSession,
    onIdentityComplete: completeTokenIdentity,
  }

  const errorStep = (err: unknown, backStep: Step): void => {
    setStep({ kind: 'error', error: identityHubErrorView(err), back: backStep })
  }

  const handleStepError = (err: unknown, backStep: Step, softCancel: Step = backStep): void => {
    if (isWalletCancelled(err)) {
      setStep(softCancel)
      return
    }
    errorStep(err, backStep)
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

  const triggerRebackup = (backStep: Step, profileUpdates?: ProfileUpdates): void => {
    if (!identity) return
    const registry = resolveRegistryForIdentity(identity)
    if (!registry) {
      errorStep(new Error('no agent registry configured for this identity'), backStep)
      return
    }
    runRebackupPreflight(identity, registry, callbacks, profileUpdates)
      .catch((err: unknown) => errorStep(err, backStep))
  }

  useEffect(() => {
    if (step.kind !== 'create-preflight') return
    let cancelled = false
    const startedAt = Date.now()
    runCreatePreflight(step, config, callbacks)
      .catch(async (err: unknown) => {
        await waitForMinimumBusyTime(startedAt)
        if (!cancelled) errorStep(err, { kind: 'create-network', name: step.name, description: step.description })
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
          errorStep(err, backStep)
          return
        }
        if (isStorageError(err)) {
          setStep({
            kind: 'create-storage',
            name: step.name,
            description: step.description,
            registry: step.registry,
            error: pinataErrorText(err),
            pinataJwt: step.pinataJwt,
          })
          return
        }
        handleStepError(err, backStep)
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-discovering') return
    let cancelled = false
    const startedAt = Date.now()
    runRestoreDiscover(step, config, callbacks)
      .catch(async (err: unknown) => {
        await waitForMinimumBusyTime(startedAt)
        if (cancelled) return
        if (isAgentTokenIdRequiredError(err)) {
          setStep({ kind: 'restore-token-id', ownerHandle: err.ownerAddress, registry: err.registry, error: err.message, purpose: step.purpose })
          return
        }
        errorStep(err, { kind: 'restore-network', ownerHandle: step.ownerHandle, purpose: step.purpose })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-wallet') return
    let cancelled = false
    runRestoreConnectWallet(step, callbacks)
      .catch((err: unknown) => { if (!cancelled) handleStepError(err, { kind: 'restore-owner', purpose: step.purpose }) })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-fetching') return
    let cancelled = false
    const startedAt = Date.now()
    runRestoreFetch(step, callbacks)
      .catch(async (err: unknown) => {
        await waitForMinimumBusyTime(startedAt)
        if (!cancelled) errorStep(err, { kind: 'restore-network', ownerHandle: step.candidate.ownerAddress, purpose: step.purpose })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-authorizing') return
    let cancelled = false
    runRestoreAuthorize(step, callbacks)
      .catch((err: unknown) => {
        if (!cancelled) handleStepError(err, { kind: 'restore-network', ownerHandle: step.candidate.ownerAddress, purpose: step.purpose })
      })
    return () => { cancelled = true }
  }, [step])

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
          })
          return
        }
        handleStepError(err, { kind: 'details' })
      })
    return () => { cancelled = true }
  }, [step])

  const footer = <Text color={theme.dim}>enter select · esc back</Text>

  if (step.kind === 'menu') {
    return (
      <MenuScreen
        mode={mode}
        config={config}
        identity={identity}
        canRebackup={canRebackup}
        footer={footer}
        onCreate={() => {
          if (identity) setStep({ kind: 'replace-confirm', next: 'create' })
          else setStep({ kind: 'create-name' })
        }}
        onLoad={() => {
          setCopyNotice(null)
          if (!identity) {
            setStep({ kind: 'restore-owner', purpose: 'restore' })
            return
          }
          const ownerHandle = identity.ownerAddress ?? identity.address
          setStep({ kind: 'restore-owner', purpose: 'switch', initialOwnerHandle: ownerHandle })
        }}
        onBackupNow={() => triggerRebackup({ kind: 'menu' })}
        onDetails={() => setStep({ kind: 'details' })}
        onSkip={() => onComplete({ kind: 'skip' })}
        onCancel={() => onComplete({ kind: 'cancel' })}
      />
    )
  }

  if (isCreateStep(step)) {
    return (
      <CreateFlow
        step={step}
        walletSession={walletSession}
        onSetStep={setStep}
        onNameSubmit={name => setStep({ kind: 'create-description', name })}
        onDescriptionSubmit={(name, description) => setStep({ kind: 'create-network', name, description })}
        onRegistrySubmit={async value => {
          if (step.kind !== 'create-registry') return
          try {
            await runRegistrySubmit(value, step, config, onConfigChange, callbacks)
          } catch (err: unknown) {
            setStep({ kind: 'create-registry', name: step.name, description: step.description, resolution: step.resolution, error: (err as Error).message })
          }
        }}
        onStorageSubmit={async input => {
          if (step.kind !== 'create-storage') return
          try {
            await runStorageSubmit(input, step, callbacks)
          } catch (err: unknown) {
            setStep({
              kind: 'create-storage',
              name: step.name,
              description: step.description,
              registry: step.registry,
              error: (err as Error).message,
              pinataJwt: step.pinataJwt,
            })
          }
        }}
        onStorageError={error => {
          if (step.kind !== 'create-storage') return
          setStep({ ...step, error })
        }}
        onBack={back}
        onMenu={() => setStep({ kind: 'menu' })}
      />
    )
  }

  if (step.kind === 'create-network') {
    return (
      <NetworkScreen
        config={config}
        footer={footer}
        onSelect={(network: SelectableNetwork) => {
          setStep({ kind: 'create-preflight', name: step.name, description: step.description, network })
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'restore-network') {
    return (
      <NetworkScreen
        config={config}
        footer={footer}
        onSelect={(network: SelectableNetwork) => {
          try {
            const registry = erc8004ConfigForSupportedChain(chainIdForNetwork(network))
            setStep({ kind: 'restore-discovering', ownerHandle: step.ownerHandle, registry, purpose: step.purpose })
          } catch (err: unknown) {
            errorStep(err, { kind: 'restore-network', ownerHandle: step.ownerHandle, purpose: step.purpose })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (isRestoreStep(step)) {
    return (
      <RestoreFlow
        step={step}
        config={config}
        walletSession={walletSession}
        onSetStep={setStep}
        onConnectWallet={() => {
          const purpose = step.kind === 'restore-owner' ? step.purpose : undefined
          setStep({ kind: 'restore-wallet', purpose })
        }}
        onOwnerSubmit={ownerHandle => {
          const purpose = step.kind === 'restore-owner' ? step.purpose : undefined
          setStep({ kind: 'restore-network', ownerHandle, purpose })
        }}
        onRestoreRegistrySubmit={async value => {
          if (step.kind !== 'restore-registry') return
          try {
            await runRestoreRegistrySubmit(value, step, config, onConfigChange, callbacks)
          } catch (err: unknown) {
            setStep({ kind: 'restore-registry', ownerHandle: step.ownerHandle, error: (err as Error).message, purpose: step.purpose })
          }
        }}
        onTokenIdSubmit={async value => {
          if (step.kind !== 'restore-token-id') return
          try {
            await runRestoreTokenIdSubmit(value, step, callbacks)
          } catch (err: unknown) {
            setStep({ ...step, error: (err as Error).message })
          }
        }}
        onTokenSelect={value => {
          if (step.kind !== 'restore-select-token') return
          const candidate = step.candidates.find(item => item.agentId.toString() === value)
          if (!candidate?.backup?.cid) return
          setStep({ kind: 'restore-fetching', cid: candidate.backup.cid, apiUrl: DEFAULT_IPFS_API_URL, candidate, purpose: step.purpose })
        }}
        onBack={back}
      />
    )
  }

  if (step.kind === 'details') {
    return (
      <DetailsScreen
        identity={identity}
        config={config}
        copyPicker={step.copyPicker}
        jwtSaved={jwtSaved}
        copyNotice={copyNotice}
        canRebackup={canRebackup}
        canEditProfile={canRebackup}
        footer={footer}
        onCopy={async (label, value) => {
          const result = await copyToClipboard(value)
          setCopyNotice(result.ok ? `copied ${label} via ${result.method}.` : `copy failed: ${result.error}`)
          setStep({ kind: 'details' })
        }}
        onOpenCopyPicker={() => setStep({ kind: 'details', copyPicker: true })}
        onCloseCopyPicker={() => setStep({ kind: 'details' })}
        onEditProfile={() => {
          if (!identity) return
          const registry = resolveRegistryForIdentity(identity)
          if (!registry) {
            errorStep(new Error('no agent registry configured for this identity'), { kind: 'details' })
            return
          }
          setStep({ kind: 'edit-profile-name', identity, registry })
        }}
        onRebackup={() => triggerRebackup({ kind: 'details' })}
        onStorageCredential={() => setStep({ kind: 'storage-credential' })}
        onForgetLocalData={() => setStep({ kind: 'forget-confirm' })}
        onBack={back}
      />
    )
  }

  if (step.kind === 'storage-credential' || step.kind === 'storage-credential-input' || step.kind === 'storage-credential-forget-confirm') {
    return (
      <StorageCredentialScreen
        step={step}
        hasCredential={jwtSaved}
        footer={footer}
        onEdit={() => setStep({ kind: 'storage-credential-input' })}
        onForget={() => setStep({ kind: 'storage-credential-forget-confirm' })}
        onConfirmForget={async () => {
          await clearPinataJwt().catch(() => {})
          setJwtSaved(false)
          setCopyNotice('IPFS storage credential removed.')
          setStep({ kind: 'details' })
        }}
        onSubmit={async input => {
          try {
            await savePinataJwt(input)
            setJwtSaved(true)
            setCopyNotice('IPFS storage credential saved.')
            setStep({ kind: 'details' })
          } catch (err: unknown) {
            setStep({ kind: 'storage-credential-input', error: (err as Error).message })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'edit-profile-name' || step.kind === 'edit-profile-description') {
    return (
      <EditProfileFlow
        step={step}
        onNameSubmit={name => {
          if (step.kind !== 'edit-profile-name') return
          setStep({ kind: 'edit-profile-description', identity: step.identity, registry: step.registry, name })
        }}
        onDescriptionSubmit={description => {
          if (step.kind !== 'edit-profile-description') return
          const updates: ProfileUpdates = { name: step.name, description }
          runRebackupPreflight(step.identity, step.registry, callbacks, updates)
            .catch((err: unknown) => errorStep(err, { kind: 'details' }))
        }}
        onBack={back}
        onMenu={() => setStep({ kind: 'details' })}
      />
    )
  }

  if (step.kind === 'forget-confirm') {
    return (
      <ForgetIdentityScreen
        identity={identity}
        config={config}
        footer={footer}
        onConfirm={() => {
          void (async () => {
            try {
              if (!config) {
                onComplete({ kind: 'cancel' })
                return
              }
              const nextConfig = await clearIdentity(config)
              onComplete({
                kind: 'updated',
                config: nextConfig,
                message: 'forgot local agent. sessions were kept.',
              })
            } catch (err: unknown) {
              errorStep(err, { kind: 'forget-confirm' })
            }
          })()
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'rebackup-signing') {
    return (
      <WalletApprovalScreen
        title="approve back up"
        subtitle="one browser flow signs, saves the IPFS backup, and updates tokenURI."
        walletSession={walletSession}
        label="waiting for wallet approval..."
        onCancel={() => setStep({ kind: 'details' })}
      />
    )
  }

  if (step.kind === 'rebackup-storage') {
    return (
      <RebackupStorageScreen
        step={step}
        footer={footer}
        onSubmit={async input => {
          try {
            await runRebackupStorageSubmit(input, step, callbacks)
          } catch (err: unknown) {
            setStep({ ...step, error: (err as Error).message })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'restore-wallet') {
    return (
      <WalletApprovalScreen
        title="connect wallet"
        subtitle="select the wallet that owns the agent you want to load."
        walletSession={walletSession}
        label="waiting for wallet..."
        onCancel={back}
      />
    )
  }

  if (step.kind === 'busy') {
    return (
      <BusyScreen
        title="Identity Hub"
        label={step.label}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'error') {
    return (
      <ErrorScreen
        error={step.error}
        back={step.back}
        footer={footer}
        onBack={backStep => setStep(backStep)}
        onClose={() => onComplete({ kind: 'cancel' })}
      />
    )
  }

  return null
}

function isCreateStep(step: Step): step is Extract<Step, { kind: 'replace-confirm' | 'create-name' | 'create-description' | 'create-preflight' | 'create-registry' | 'create-signing' | 'create-storage' }> {
  return step.kind === 'replace-confirm'
    || step.kind === 'create-name'
    || step.kind === 'create-description'
    || step.kind === 'create-preflight'
    || step.kind === 'create-registry'
    || step.kind === 'create-signing'
    || step.kind === 'create-storage'
}

function isRestoreStep(step: Step): step is Exclude<Extract<Step, { kind: `restore-${string}` }>, { kind: 'restore-wallet' | 'restore-network' }> {
  return step.kind.startsWith('restore-') && step.kind !== 'restore-wallet' && step.kind !== 'restore-network'
}

function initialStepForAction(
  action: IdentityHubInitialAction | undefined,
  config: EthagentConfig | undefined,
): Step {
  if (action === 'create') return config?.identity ? { kind: 'replace-confirm', next: 'create' } : { kind: 'create-name' }
  if (action === 'load') return { kind: 'restore-owner', purpose: config?.identity ? 'switch' : 'restore' }
  return { kind: 'menu' }
}
