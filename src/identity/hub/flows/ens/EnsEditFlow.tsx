import React from 'react'
import { getAddress, type Address } from 'viem'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'
import { requestBrowserWalletAccount } from '../../../wallet/browserWallet.js'
import {
  AGENT_RECORD_READ_KEY_LIST,
  buildAgentEnsRecords,
  diffRecords,
  recordsFromTextMap,
} from '../../../ens/agentRecords.js'
import {
  discoverOwnedEnsNameDetails,
  readEthagentTextRecords,
  sanitizeSubdomainPrefix,
  splitSubdomainName,
  validateAgentEnsLink,
} from '../../../ens/ensLookup.js'
import {
  preflightDeleteSubdomain,
  preflightEnsRoot,
  preflightEnsSetup,
} from '../../../ens/ensAutomation.js'
import {
  readCustodyMode,
  readIdentityStateString,
} from '../../model/custody.js'
import {
  discoveryErrorMessage,
  emptyAgentEnsRecords,
  networkLabelForChainId,
  type EnsLinkOptions,
} from './ensEditCopy.js'
import { rootErrorMessage } from './EnsEditShared.js'
import { renderAdvancedEnsPhase } from './EnsEditAdvancedScreens.js'
import { renderEnsMaintenancePhase } from './EnsEditMaintenanceScreens.js'
import { renderSimpleEnsPhase } from './EnsEditSimpleScreens.js'
import type {
  DiscoveryState,
  EnsEditProps,
  EnsPhase,
} from './ensEditTypes.js'

export type { EnsLinkOptions }

export const EnsEditFlow: React.FC<EnsEditProps> = ({
  identity,
  registry,
  onEnsLink,
  onEnsUnlink,
  onEnsRecordsUpdate,
  onEnsSetup,
  onManageOperatorWalletAccess,
  initialView,
  onBack,
}) => {
  const ownerAddress = getAddress((identity.ownerAddress ?? identity.address) as Address)
  const currentEnsName = readIdentityStateString(identity.state, 'ensName')
  const currentEnsParts = currentEnsName ? splitSubdomainName(currentEnsName) : null
  const savedRootName = currentEnsParts?.parent ?? ''
  const savedSubdomainLabel = currentEnsParts?.label ?? ''
  const agentNameSuggestion = sanitizeSubdomainPrefix(readIdentityStateString(identity.state, 'name'))
  const agentCardCid = identity.publicSkills?.agentCardCid
  const savedCustodyMode = readCustodyMode(identity.state)
  const savedOwnerAddress = readIdentityStateString(identity.state, 'ownerAddress')
  const savedOperator = readIdentityStateString(identity.state, 'activeOperatorAddress')
  const registryNetworkLabel = networkLabelForChainId(registry.chainId)
  const hasAdvancedSetup = savedCustodyMode === 'advanced' && Boolean(savedOwnerAddress) && Boolean(currentEnsName)

  const [discovery, setDiscovery] = React.useState<DiscoveryState>({ status: 'idle' })
  const [phase, setPhase] = React.useState<EnsPhase>(() => {
    if (initialView === 'advanced' && !hasAdvancedSetup) return { kind: 'advanced-transfer-check' }
    return { kind: 'mode-select' }
  })
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [discoveryStartedAt, setDiscoveryStartedAt] = React.useState<number>(() => Date.now())
  const [operatorWalletSession, setOperatorWalletSession] = React.useState<BrowserWalletReady | null>(null)
  const discoveryControllerRef = React.useRef<AbortController | null>(null)

  const runDiscovery = React.useCallback(() => {
    discoveryControllerRef.current?.abort()
    const controller = new AbortController()
    discoveryControllerRef.current = controller
    setDiscovery({ status: 'loading' })
    setDiscoveryStartedAt(Date.now())
    setPhase({ kind: 'discovering' })
    discoverOwnedEnsNameDetails(ownerAddress, {
      signal: controller.signal,
      budgetMs: 30_000,
      rpcTimeoutMs: 8_000,
    })
      .then(result => {
        if (controller.signal.aborted) return
        if (discoveryControllerRef.current === controller) discoveryControllerRef.current = null
        if (result.status === 'error') {
          setDiscovery({ status: 'error', message: discoveryErrorMessage(result.errors), names: [] })
          setPhase({ kind: 'pick-parent' })
          return
        }
        setDiscovery({
          status: 'ok',
          names: result.names,
          ...(result.status === 'partial' ? { warning: 'Some ENS lookup sources failed; showing root names found so far.' } : {}),
        })
        setPhase({ kind: 'pick-parent' })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (discoveryControllerRef.current === controller) discoveryControllerRef.current = null
        setDiscovery({ status: 'error', message: err instanceof Error ? err.message : String(err), names: [] })
        setPhase({ kind: 'pick-parent' })
      })
  }, [ownerAddress])

  React.useEffect(() => () => {
    discoveryControllerRef.current?.abort()
  }, [])

  const cancelDiscoveryToModeSelect = React.useCallback(() => {
    discoveryControllerRef.current?.abort()
    discoveryControllerRef.current = null
    setDiscovery({ status: 'idle' })
    setPhase({ kind: 'mode-select' })
  }, [])

  const backToSimpleSubdomain = React.useCallback((fullName: string): void => {
    const parts = splitSubdomainName(fullName)
    setPhase(parts ? { kind: 'pick-subdomain', parent: parts.parent, label: parts.label } : { kind: 'pick-parent' })
  }, [])

  const runValidation = React.useCallback(async (
    fullName: string,
    mode: 'simple' | 'advanced',
    phaseOwnerAddress?: Address,
    operatorWallet?: Address,
  ): Promise<void> => {
    setValidationError(null)
    setPhase({ kind: 'validating', fullName, mode, ownerAddress: phaseOwnerAddress, operatorWallet })
    try {
      const validation = await validateAgentEnsLink(fullName, ownerAddress)
      const currentText = validation.ok
        ? await readEthagentTextRecords(fullName, AGENT_RECORD_READ_KEY_LIST)
        : {}
      const current = recordsFromTextMap(currentText)
      const next = buildAgentEnsRecords({
        chainId: registry.chainId,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: identity.agentId,
        agentCardCid,
      })
      const recordsDiff = diffRecords(current, next)
      if (mode === 'simple' && !validation.ok && validation.reason === 'no-owner') {
        setPhase({ kind: 'simple-name-missing', fullName, validation })
        return
      }
      setPhase({ kind: 'review', fullName, validation, recordsDiff, currentRecords: current, nextRecords: next, mode, ownerAddress: phaseOwnerAddress, operatorWallet })
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : String(err))
      setPhase({ kind: 'pick-parent' })
    }
  }, [ownerAddress, registry, identity.agentId, agentCardCid])

  const runAdvancedPreflight = React.useCallback((
    rootName: string,
    label: string,
    operatorWallet: Address,
  ): void => {
    setPhase({ kind: 'advanced-preflight', rootName, label, operatorWallet })
    preflightEnsSetup({
      rootName,
      label,
      operatorAddress: operatorWallet,
      registry,
      agentId: identity.agentId,
      agentCardCid,
    }).then(result => {
      if (result.ok) {
        setPhase({ kind: 'advanced-review', setup: result.setup })
        return
      }
      setPhase({ kind: 'advanced-manual', fallback: result.fallback })
    }).catch((err: unknown) => {
      setPhase({
        kind: 'advanced-operator-wallet',
        rootName,
        label,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, [agentCardCid, identity.agentId, registry])

  const runAdvancedRootCheck = React.useCallback((rootName: string): void => {
    setPhase({ kind: 'advanced-root-check', rootName })
    preflightEnsRoot({
      rootName,
      expectedOwnerAddress: ownerAddress,
      registry,
      agentId: identity.agentId,
    }).then(result => {
      if (result.ok) {
        setPhase({ kind: 'advanced-subdomain', rootName, label: savedSubdomainLabel || agentNameSuggestion })
        return
      }
      setPhase({ kind: 'advanced-root', rootName, error: rootErrorMessage(result.reason, result.detail, rootName) })
    }).catch((err: unknown) => {
      setPhase({ kind: 'advanced-root', rootName, error: err instanceof Error ? err.message : String(err) })
    })
  }, [agentNameSuggestion, identity.agentId, ownerAddress, registry, savedSubdomainLabel])

  const runAdvancedSubdomainCheck = React.useCallback((rootName: string, label: string): void => {
    setPhase({ kind: 'advanced-subdomain-check', rootName, label })
    preflightEnsSetup({
      rootName,
      label,
      operatorAddress: ownerAddress,
      allowSameOwnerOperator: true,
      registry,
      agentId: identity.agentId,
      agentCardCid,
    }).then(result => {
      if (result.ok) {
        setPhase({
          kind: 'advanced-operator-wallet',
          rootName: result.setup.rootName,
          label: result.setup.label,
          registryAction: result.setup.registryAction,
        })
        return
      }
      setPhase({ kind: 'advanced-manual', fallback: result.fallback })
    }).catch((err: unknown) => {
      setPhase({
        kind: 'advanced-subdomain',
        rootName,
        label,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, [agentCardCid, identity.agentId, ownerAddress, registry])

  const runSimpleCreatePreflight = React.useCallback((fullName: string): void => {
    const parts = splitSubdomainName(fullName)
    if (!parts) {
      setPhase({ kind: 'pick-parent' })
      return
    }
    setPhase({ kind: 'simple-create-preflight', rootName: parts.parent, label: parts.label, fullName })
    preflightEnsSetup({
      rootName: parts.parent,
      label: parts.label,
      operatorAddress: ownerAddress,
      mode: 'simple',
      expectedOwnerAddress: ownerAddress,
      allowSameOwnerOperator: true,
      registry,
      agentId: identity.agentId,
      agentCardCid,
    }).then(result => {
      if (result.ok) {
        setPhase({ kind: 'simple-create-review', setup: result.setup })
        return
      }
      setPhase({ kind: 'simple-create-blocked', fallback: result.fallback })
    }).catch((err: unknown) => {
      setPhase({
        kind: 'pick-subdomain',
        parent: parts.parent,
        label: parts.label,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, [agentCardCid, identity.agentId, ownerAddress, registry])

  const connectOperatorWallet = React.useCallback((rootName: string, label: string): void => {
    setOperatorWalletSession(null)
    setPhase({ kind: 'advanced-operator-wallet-connecting', rootName, label })
    requestBrowserWalletAccount({
      purpose: 'connect-operator-wallet',
      onReady: ready => setOperatorWalletSession(ready),
    }).then(wallet => {
      const operatorWallet = getAddress(wallet.account)
      setOperatorWalletSession(null)
      runAdvancedPreflight(rootName, label, operatorWallet)
    }).catch((err: unknown) => {
      setOperatorWalletSession(null)
      setPhase({ kind: 'advanced-operator-wallet', rootName, label, error: err instanceof Error ? err.message : String(err) })
    })
  }, [runAdvancedPreflight])

  const runDeleteSubdomainPreflight = React.useCallback((fullName: string): void => {
    setValidationError(null)
    setPhase({ kind: 'delete-subdomain-preflight', fullName })
    preflightDeleteSubdomain({ fullName, expectedOwnerAddress: ownerAddress })
      .then(result => {
        if (result.ok) {
          setPhase({ kind: 'delete-subdomain-confirm', plan: result.plan })
          return
        }
        setPhase({ kind: 'delete-subdomain-blocked', fullName, reason: result.detail })
      })
      .catch((err: unknown) => {
        setPhase({ kind: 'delete-subdomain-blocked', fullName, reason: err instanceof Error ? err.message : String(err) })
      })
  }, [ownerAddress])

  const runUnlinkEnsLoading = React.useCallback((fullName: string): void => {
    setValidationError(null)
    setPhase({ kind: 'unlink-loading', fullName })
    readEthagentTextRecords(fullName, AGENT_RECORD_READ_KEY_LIST)
      .then(currentText => {
        const currentRecords = recordsFromTextMap(currentText)
        setPhase({
          kind: 'unlink-review',
          fullName,
          currentRecords,
          recordsDiff: diffRecords(currentRecords, emptyAgentEnsRecords()),
        })
      })
      .catch((err: unknown) => {
        setValidationError(err instanceof Error ? err.message : String(err))
        setPhase({ kind: 'mode-select' })
      })
  }, [])

  const maintenanceScreen = renderEnsMaintenancePhase({
    phase,
    currentEnsName,
    currentEnsCanDelete: Boolean(currentEnsParts),
    savedCustodyMode,
    savedOwnerAddress,
    savedOperator,
    registryNetworkLabel,
    validationError,
    ownerAddress,
    operatorWalletSession,
    setOperatorWalletSession,
    setPhase,
    runDiscovery,
    runUnlinkEnsLoading,
    runDeleteSubdomainPreflight,
    onBack,
    onEnsUnlink,
    onEnsRecordsUpdate,
    onManageOperatorWalletAccess,
  })
  if (maintenanceScreen) return maintenanceScreen

  const advancedScreen = renderAdvancedEnsPhase({
    phase,
    ownerAddress,
    agentId: identity.agentId,
    savedOwnerAddress,
    savedOperator,
    savedRootName,
    savedSubdomainLabel,
    agentNameSuggestion,
    currentEnsName,
    savedCustodyMode,
    registry,
    operatorWalletSession,
    setPhase,
    connectOperatorWallet,
    runAdvancedRootCheck,
    runAdvancedSubdomainCheck,
    runAdvancedPreflight,
    onEnsSetup,
    onEnsLink,
  })
  if (advancedScreen) return advancedScreen

  const simpleScreen = renderSimpleEnsPhase({
    phase,
    discovery,
    ownerAddress,
    discoveryStartedAt,
    validationError,
    currentEnsName,
    savedCustodyMode,
    registryNetworkLabel,
    registry,
    agentNameSuggestion,
    operatorWalletSession,
    setOperatorWalletSession,
    setPhase,
    cancelDiscoveryToModeSelect,
    runDiscovery,
    runValidation,
    backToSimpleSubdomain,
    runSimpleCreatePreflight,
    onEnsSetup,
    onEnsLink,
    onEnsRecordsUpdate,
    identity,
  })
  if (simpleScreen) return simpleScreen

  return null
}
