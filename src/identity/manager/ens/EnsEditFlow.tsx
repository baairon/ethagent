import React from 'react'
import { getAddress, type Address } from 'viem'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import {
  buildAgentEnsRecords,
  diffRecords,
  recordsFromTextMap,
} from '../../ens/agentRecords.js'
import {
  discoverOwnedEnsNameDetails,
  readEthagentTextRecords,
  splitSubdomainName,
  validateAgentEnsLink,
} from '../../ens/ensLookup.js'
import {
  preflightDeleteSubdomain,
  preflightEnsRoot,
  preflightEnsSetup,
} from '../../ens/ensAutomation.js'
import { agentEnsRecordKeys } from './records.js'
import {
  readCustodyMode,
  readIdentityStateString,
} from '../custody/state.js'
import {
  discoveryErrorMessage,
  emptyAgentEnsRecords,
  type EnsLinkOptions,
} from './editCopy.js'
import { rootErrorMessage } from './EnsEditShared.js'
import { renderAdvancedEnsPhase } from './EnsEditAdvancedScreens.js'
import { renderEnsMaintenancePhase } from './EnsEditMaintenanceScreens.js'
import { renderSimpleEnsPhase } from './EnsEditSimpleScreens.js'
import type {
  DiscoveryState,
  EnsEditProps,
  EnsPhase,
} from './types.js'

export type { EnsLinkOptions }

export const EnsEditFlow: React.FC<EnsEditProps> = ({
  identity,
  registry,
  onEnsLink,
  onEnsUnlink,
  onEnsRecordsUpdate,
  onEnsSetup,
  initialView,
  onBack,
}) => {
  const ownerAddress = getAddress((identity.ownerAddress ?? identity.address) as Address)
  const currentEnsName = readIdentityStateString(identity.state, 'ensName')
  const currentEnsParts = currentEnsName ? splitSubdomainName(currentEnsName) : null
  const savedSubdomainLabel = currentEnsParts?.label ?? ''
  const savedCustodyMode = readCustodyMode(identity.state)
  const savedOwnerAddress = readIdentityStateString(identity.state, 'ownerAddress')
  const savedOperator = readIdentityStateString(identity.state, 'activeOperatorAddress')
  const hasAdvancedSetup = savedCustodyMode === 'advanced' && Boolean(savedOwnerAddress) && Boolean(currentEnsName)

  const [discovery, setDiscovery] = React.useState<DiscoveryState>({ status: 'idle' })
  const [phase, setPhase] = React.useState<EnsPhase>(() => {
    if (initialView === 'advanced' && !hasAdvancedSetup) return { kind: 'pick-parent', mode: 'advanced' }
    return { kind: 'mode-select' }
  })
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [discoveryStartedAt, setDiscoveryStartedAt] = React.useState<number>(() => Date.now())
  const [operatorWalletSession, setOperatorWalletSession] = React.useState<BrowserWalletReady | null>(null)
  const discoveryControllerRef = React.useRef<AbortController | null>(null)

  const phaseRef = React.useRef(phase)
  phaseRef.current = phase
  const settle = React.useCallback((stillWaiting: (current: EnsPhase) => boolean, next: EnsPhase): void => {
    if (stillWaiting(phaseRef.current)) setPhase(next)
  }, [])

  const runDiscovery = React.useCallback((targetMode: 'simple' | 'advanced' = 'simple') => {
    discoveryControllerRef.current?.abort()
    const controller = new AbortController()
    discoveryControllerRef.current = controller
    setDiscovery({ status: 'loading' })
    setDiscoveryStartedAt(Date.now())
    setPhase({ kind: 'discovering', mode: targetMode })
    discoverOwnedEnsNameDetails(ownerAddress, {
      signal: controller.signal,
    })
      .then(result => {
        if (controller.signal.aborted) return
        if (discoveryControllerRef.current === controller) discoveryControllerRef.current = null
        if (result.status === 'error') {
          setDiscovery({ status: 'error', message: discoveryErrorMessage(result.errors), names: [] })
          setPhase({ kind: 'pick-parent', mode: targetMode })
          return
        }
        setDiscovery({
          status: 'ok',
          names: result.names,
          ...(result.status === 'partial' ? { warning: 'Some lookups failed. Showing the names found so far.' } : {}),
        })
        setPhase({ kind: 'pick-parent', mode: targetMode })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (discoveryControllerRef.current === controller) discoveryControllerRef.current = null
        setDiscovery({ status: 'error', message: err instanceof Error ? err.message : String(err), names: [] })
        setPhase({ kind: 'pick-parent', mode: targetMode })
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

  const runSimpleCreatePreflight = React.useCallback((fullName: string): void => {
    const parts = splitSubdomainName(fullName)
    if (!parts) {
      setPhase({ kind: 'pick-parent' })
      return
    }
    setPhase({ kind: 'simple-create-preflight', rootName: parts.parent, label: parts.label, fullName })
    const waiting = (current: EnsPhase) => current.kind === 'simple-create-preflight' && current.fullName === fullName
    preflightEnsSetup({
      rootName: parts.parent,
      label: parts.label,
      operatorAddress: ownerAddress,
      mode: 'simple',
      expectedOwnerAddress: ownerAddress,
      allowSameOwnerOperator: true,
      registry,
      agentId: identity.agentId,
    }).then(result => {
      settle(waiting, result.ok
        ? { kind: 'simple-create-review', setup: result.setup }
        : { kind: 'simple-create-blocked', fallback: result.fallback })
    }).catch((err: unknown) => {
      settle(waiting, {
        kind: 'pick-subdomain',
        parent: parts.parent,
        label: parts.label,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, [identity.agentId, ownerAddress, registry, settle])

  const runValidation = React.useCallback(async (
    fullName: string,
    mode: 'simple' | 'advanced',
    phaseOwnerAddress?: Address,
    operatorWallet?: Address,
  ): Promise<void> => {
    setValidationError(null)
    setPhase({ kind: 'validating', fullName, mode, ownerAddress: phaseOwnerAddress, operatorWallet })
    const waiting = (current: EnsPhase) => current.kind === 'validating' && current.fullName === fullName
    try {
      const validation = await validateAgentEnsLink(fullName, ownerAddress)
      if (mode === 'simple' && !validation.ok && validation.reason === 'no-owner') {
        if (waiting(phaseRef.current)) runSimpleCreatePreflight(fullName)
        return
      }
      const readKeys = agentEnsRecordKeys(registry.identityRegistryAddress, identity.agentId)
      const currentText = validation.ok && readKeys.length > 0
        ? await readEthagentTextRecords(fullName, readKeys)
        : {}
      const current = recordsFromTextMap(currentText)
      const next = buildAgentEnsRecords({
        chainId: registry.chainId,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: identity.agentId,
      })
      const recordsDiff = diffRecords(current, next)
      settle(waiting, { kind: 'review', fullName, validation, recordsDiff, currentRecords: current, nextRecords: next, mode, ownerAddress: phaseOwnerAddress, operatorWallet })
    } catch (err: unknown) {
      if (!waiting(phaseRef.current)) return
      setValidationError(err instanceof Error ? err.message : String(err))
      setPhase(fullName === currentEnsName ? { kind: 'mode-select' } : { kind: 'pick-parent' })
    }
  }, [ownerAddress, registry, identity.agentId, currentEnsName, runSimpleCreatePreflight, settle])

  const runCheckAgain = React.useCallback((): void => {
    if (!currentEnsName) return
    const advanced = savedCustodyMode === 'advanced' && /^0x[0-9a-fA-F]{40}$/.test(savedOwnerAddress)
    void runValidation(
      currentEnsName,
      advanced ? 'advanced' : 'simple',
      advanced ? getAddress(savedOwnerAddress as Address) : undefined,
      advanced && /^0x[0-9a-fA-F]{40}$/.test(savedOperator) ? getAddress(savedOperator as Address) : undefined,
    )
  }, [currentEnsName, runValidation, savedCustodyMode, savedOperator, savedOwnerAddress])

  const runAdvancedRootCheck = React.useCallback((rootName: string): void => {
    setPhase({ kind: 'advanced-root-check', rootName })
    const waiting = (current: EnsPhase) => current.kind === 'advanced-root-check' && current.rootName === rootName
    preflightEnsRoot({
      rootName,
      expectedOwnerAddress: ownerAddress,
      registry,
      agentId: identity.agentId,
    }).then(result => {
      settle(waiting, result.ok
        ? { kind: 'advanced-subdomain', rootName, label: savedSubdomainLabel }
        : { kind: 'pick-parent', mode: 'advanced', error: rootErrorMessage(result.reason, result.detail, rootName) })
    }).catch((err: unknown) => {
      settle(waiting, { kind: 'pick-parent', mode: 'advanced', error: err instanceof Error ? err.message : String(err) })
    })
  }, [identity.agentId, ownerAddress, registry, savedSubdomainLabel, settle])

  const runAdvancedSubdomainCheck = React.useCallback((rootName: string, label: string): void => {
    setPhase({ kind: 'advanced-subdomain-check', rootName, label })
    const waiting = (current: EnsPhase) => current.kind === 'advanced-subdomain-check' && current.rootName === rootName && current.label === label
    preflightEnsSetup({
      rootName,
      label,
      operatorAddress: ownerAddress,
      allowSameOwnerOperator: true,
      registry,
      agentId: identity.agentId,
    }).then(result => {
      settle(waiting, result.ok
        ? { kind: 'advanced-review', setup: result.setup }
        : { kind: 'advanced-manual', fallback: result.fallback })
    }).catch((err: unknown) => {
      settle(waiting, {
        kind: 'advanced-subdomain',
        rootName,
        label,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, [identity.agentId, ownerAddress, registry, settle])

  const runDeleteSubdomainPreflight = React.useCallback((fullName: string): void => {
    setValidationError(null)
    setPhase({ kind: 'delete-subdomain-preflight', fullName })
    const waiting = (current: EnsPhase) => current.kind === 'delete-subdomain-preflight' && current.fullName === fullName
    preflightDeleteSubdomain({ fullName, expectedOwnerAddress: ownerAddress })
      .then(result => {
        settle(waiting, result.ok
          ? { kind: 'delete-subdomain-confirm', plan: result.plan }
          : { kind: 'delete-subdomain-blocked', fullName, reason: result.detail })
      })
      .catch((err: unknown) => {
        settle(waiting, { kind: 'delete-subdomain-blocked', fullName, reason: err instanceof Error ? err.message : String(err) })
      })
  }, [ownerAddress, settle])

  const runUnlinkEnsLoading = React.useCallback((fullName: string): void => {
    setValidationError(null)
    setPhase({ kind: 'unlink-loading', fullName })
    const waiting = (current: EnsPhase) => current.kind === 'unlink-loading' && current.fullName === fullName
    const readKeys = agentEnsRecordKeys(registry.identityRegistryAddress, identity.agentId)
    readEthagentTextRecords(fullName, readKeys)
      .then(currentText => {
        const currentRecords = recordsFromTextMap(currentText)
        settle(waiting, {
          kind: 'unlink-review',
          fullName,
          currentRecords,
          recordsDiff: diffRecords(currentRecords, emptyAgentEnsRecords()),
        })
      })
      .catch((err: unknown) => {
        if (!waiting(phaseRef.current)) return
        setValidationError(err instanceof Error ? err.message : String(err))
        setPhase({ kind: 'mode-select' })
      })
  }, [identity.agentId, registry.identityRegistryAddress, settle])

  const maintenanceScreen = renderEnsMaintenancePhase({
    phase,
    identity,
    currentEnsName,
    savedCustodyMode,
    savedOwnerAddress,
    validationError,
    ownerAddress,
    operatorWalletSession,
    setOperatorWalletSession,
    setPhase,
    runDiscovery,
    runCheckAgain,
    runUnlinkEnsLoading,
    runDeleteSubdomainPreflight,
    onBack,
    onEnsUnlink,
    onEnsRecordsUpdate,
  })
  if (maintenanceScreen) return maintenanceScreen

  const advancedScreen = renderAdvancedEnsPhase({
    phase,
    ownerAddress,
    savedSubdomainLabel,
    currentEnsName,
    setPhase,
    runAdvancedSubdomainCheck,
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
    setPhase,
    cancelDiscoveryToModeSelect,
    runDiscovery,
    runValidation,
    runAdvancedRootCheck,
    backToSimpleSubdomain,
    runSimpleCreatePreflight,
    onEnsSetup,
    onEnsLink,
    onEnsRecordsUpdate,
  })
  if (simpleScreen) return simpleScreen

  return null
}
