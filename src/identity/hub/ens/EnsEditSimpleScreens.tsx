import React from 'react'
import { Box, Text } from 'ink'
import { type Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../ui/Select.js'
import { Spinner } from '../../../ui/Spinner.js'
import { theme } from '../../../ui/theme.js'
import {
  isEthDomain,
  normalizeEthDomain,
} from '../../ens/ensLookup.js'
import { isRootEthName } from '../../ens/ensAutomation.js'
import type { Erc8004RegistryConfig } from '../../registry/erc8004.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import {
  type CustodyMode,
} from '../custody/state.js'
import { shortAddress } from '../shared/model/format.js'
import {
  recordsDiffHasChanges,
  type EnsLinkOptions,
} from './editCopy.js'
import { openExternalUrl } from '../../../utils/openExternal.js'
import { TextInput } from '../../../ui/TextInput.js'
import {
  EnsStatusBanner,
  footerHint,
  SubdomainEntry,
} from './EnsEditShared.js'
import {
  EnsSetupBlockedScreen,
  EnsSetupReviewScreen,
  ReviewScreen,
  SimpleEnsIssueScreen,
} from './EnsEditReviewScreens.js'
import { EscCancel } from './EnsEditRunners.js'
import type {
  DiscoveryState,
  EnsEditProps,
  EnsPhase,
} from './types.js'

const ENS_DOMAINS_URL = 'https://app.ens.domains'

type SimpleScreenProps = {
  phase: EnsPhase
  discovery: DiscoveryState
  ownerAddress: Address
  discoveryStartedAt: number
  validationError: string | null
  currentEnsName: string
  savedCustodyMode: CustodyMode | undefined
  registryNetworkLabel: string
  registry: Erc8004RegistryConfig
  agentNameSuggestion: string
  operatorWalletSession: BrowserWalletReady | null
  setOperatorWalletSession: (session: BrowserWalletReady | null) => void
  setPhase: (phase: EnsPhase) => void
  cancelDiscoveryToModeSelect: () => void
  runDiscovery: (mode?: 'simple' | 'advanced') => void
  runValidation: (fullName: string, mode: 'simple' | 'advanced', phaseOwnerAddress?: Address, operatorWallet?: Address) => Promise<void>
  runAdvancedRootCheck: (rootName: string) => void
  backToSimpleSubdomain: (fullName: string) => void
  runSimpleCreatePreflight: (fullName: string) => void
  onEnsSetup: EnsEditProps['onEnsSetup']
  onEnsLink: EnsEditProps['onEnsLink']
  onEnsRecordsUpdate: EnsEditProps['onEnsRecordsUpdate']
  identity: EnsEditProps['identity']
}

export function renderSimpleEnsPhase({
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
  runAdvancedRootCheck,
  backToSimpleSubdomain,
  runSimpleCreatePreflight,
  onEnsSetup,
  onEnsLink,
  onEnsRecordsUpdate,
  identity,
}: SimpleScreenProps): React.ReactNode | null {
  const statusBanner = (
    <EnsStatusBanner identity={identity} />
  )

  if (phase.kind === 'discovering' || discovery.status === 'loading') {
    return (
      <Surface
        title="Assign ENS Name"
        subtitle="Reading your primary ENS name from Ethereum mainnet."
        footer={footerHint('esc cancels')}
      >
        <Box marginTop={1}>
          <Spinner
            label={`Looking up root ENS names for ${shortAddress(ownerAddress)}...`}
            startedAt={discoveryStartedAt}
          />
        </Box>
        <EscCancel onCancel={cancelDiscoveryToModeSelect} />
      </Surface>
    )
  }

  if (phase.kind === 'pick-parent') {
    type DomainAction = `pick:${string}` | 'open-ens-domains' | 'manual' | 'retry' | 'back'
    const ownedNames = discovery.status === 'ok' || discovery.status === 'error' ? discovery.names : []
    const errorMessage = discovery.status === 'error' ? 'Root ENS Lookup Failed' : null
    const warningMessage = discovery.status === 'ok' ? discovery.warning : null

    const noOwnedNames = discovery.status === 'ok' && ownedNames.length === 0

    const options: Array<SelectOption<DomainAction>> = [
      ...(ownedNames.length > 0
        ? [
            { value: 'pick:section' as DomainAction, role: 'section' as const, label: 'Your ENS Names' },
            ...ownedNames.map(name => ({
              value: `pick:${name}` as DomainAction,
              label: name,
              hint: `Next, choose the subdomain under ${name}`,
            })),
          ]
        : []),
      { value: 'open-ens-domains' as DomainAction, role: 'section' as const, label: 'No Parent Name?' },
      { value: 'open-ens-domains' as DomainAction, label: 'Register .eth Name', hint: 'Opens ENS app; return once this wallet owns one' },
      ...(noOwnedNames || discovery.status === 'ok'
        ? [{ value: 'retry' as DomainAction, label: 'Scan Again', hint: 'Re-run root .eth name discovery for this wallet' }]
        : []),
      ...(discovery.status === 'error'
        ? [
            { value: 'retry' as DomainAction, label: errorMessage ? 'Try Again' : 'Retry Lookup', hint: 'Retry root ENS name search' },
            { value: 'manual' as DomainAction, label: 'Enter ENS Name Manually', hint: 'Lookup failed; type a root .eth name you own' },
          ]
        : []),
      { value: 'back', role: 'section', label: 'Navigation' },
      { value: 'back', label: 'Back', hint: 'Return to setup type', role: 'utility' },
    ]

    const advancedMode = phase.mode === 'advanced'
    return (
      <Surface
        title="Assign ENS Name"
        subtitle="Choose a root .eth name, then create a dedicated agent subdomain under it."
        footer={footerHint('enter select · esc back')}
      >
        <EnsStatusBanner identity={identity} noRootEnsName={noOwnedNames} />
        {advancedMode
          ? <Text color={theme.dim}>Owner wallet: <Text color={theme.text}>{shortAddress(ownerAddress)}</Text></Text>
          : null}
        {validationError ? <Text color={theme.accentError}>{validationError}</Text> : null}
        {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        {errorMessage ? <Text color={theme.accentError}>{errorMessage}: {discovery.status === 'error' ? discovery.message : ''}</Text> : null}
        {warningMessage ? <Text color={theme.accentPeriwinkle}>{warningMessage}</Text> : null}
        {noOwnedNames
          ? (
              <Box marginTop={1} flexDirection="column">
                <Text color={theme.dim}>This wallet does not own a parent <Text color={theme.text}>.eth</Text> name yet.</Text>
                <Text color={theme.dim}>Register one at <Text color={theme.text}>{ENS_DOMAINS_URL}</Text>, then come back and Scan Again.</Text>
              </Box>
            )
          : null}
        <Box marginTop={1}>
          <Select<DomainAction>
            options={options}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'back') return setPhase({ kind: 'mode-select' })
              if (choice === 'manual') { setPhase({ kind: 'manual-parent', ...(advancedMode ? { mode: 'advanced' as const } : {}) }); return }
              if (choice === 'open-ens-domains') {
                openExternalUrl(ENS_DOMAINS_URL)
                return
              }
              if (choice === 'retry') {
                runDiscovery(advancedMode ? 'advanced' : 'simple')
                return
              }
              if (choice.startsWith('pick:')) {
                const name = choice.slice('pick:'.length)
                if (!name) return
                if (advancedMode) {
                  runAdvancedRootCheck(name)
                  return
                }
                setPhase({ kind: 'pick-subdomain', parent: name })
              }
            }}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'manual-parent') {
    const advancedMode = phase.mode === 'advanced'
    return (
      <Surface
        title="Your Root .eth Name"
        subtitle="Type the root .eth name you own. Your agent becomes a subdomain of it."
        footer={footerHint('enter continues · esc back')}
      >
        {statusBanner}
        {advancedMode
          ? <Text color={theme.dim}>Owner wallet: <Text color={theme.text}>{shortAddress(ownerAddress)}</Text></Text>
          : null}
        <Box marginTop={1}>
          <Text color={theme.dim}>Only root .eth names on Ethereum mainnet are supported.</Text>
        </Box>
        {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        <TextInput
          key={`edit-ens-parent-manual-${advancedMode ? 'advanced' : 'simple'}`}
          placeholder="e.g. name.eth"
          validate={value => {
            const v = normalizeEthDomain(value)
            if (!v) return 'Enter a .eth name'
            if (!isEthDomain(v)) return 'Must be a valid .eth name'
            if (!isRootEthName(v)) return 'Enter a root .eth name, e.g. name.eth'
            return null
          }}
          onSubmit={value => {
            const root = normalizeEthDomain(value)
            if (advancedMode) {
              runAdvancedRootCheck(root)
              return
            }
            setPhase({ kind: 'pick-subdomain', parent: root })
          }}
          onCancel={() => setPhase({ kind: 'pick-parent', ...(advancedMode ? { mode: 'advanced' as const } : {}) })}
        />
      </Surface>
    )
  }

  if (phase.kind === 'pick-subdomain') {
    return (
      <SubdomainEntry
        parent={phase.parent}
        ownerAddress={ownerAddress}
        initialValue={phase.label}
        placeholder={agentNameSuggestion || 'subdomain name'}
        error={phase.error}
        onConfirm={fullName => { void runValidation(fullName, 'simple') }}
        onBack={() => setPhase({ kind: 'pick-parent' })}
      />
    )
  }

  if (phase.kind === 'validating') {
    return (
      <Surface
        title="Check ENS Name"
        subtitle={phase.mode === 'simple' ? undefined : `Verifying ${phase.fullName}`}
        footer={footerHint('esc cancels')}
      >
        <Box marginTop={1}>
          <Spinner label="Looking up resolver and address record..." />
        </Box>
        <EscCancel onCancel={() => backToSimpleSubdomain(phase.fullName)} />
      </Surface>
    )
  }

  if (phase.kind === 'simple-name-missing') {
    return (
      <SimpleEnsIssueScreen
        fullName={phase.fullName}
        validation={phase.validation}
        onCreate={() => runSimpleCreatePreflight(phase.fullName)}
        onCheckAgain={() => { void runValidation(phase.fullName, 'simple') }}
        onChange={() => backToSimpleSubdomain(phase.fullName)}
        onBack={() => backToSimpleSubdomain(phase.fullName)}
      />
    )
  }

  if (phase.kind === 'simple-create-preflight') {
    return (
      <Surface
        title="Prepare ENS Name"
        footer={footerHint('esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Name: <Text color={theme.text}>{phase.fullName}</Text></Text>
          <Text color={theme.dim}>Connected wallet will create the subdomain and set the required records if checks pass.</Text>
        </Box>
        <Box marginTop={1}>
          <Spinner label="checking parent ownership and record changes..." />
        </Box>
        <EscCancel onCancel={() => backToSimpleSubdomain(phase.fullName)} />
      </Surface>
    )
  }

  if (phase.kind === 'simple-create-review') {
    return (
      <EnsSetupReviewScreen
        setup={phase.setup}
        currentEnsName={currentEnsName}
        currentMode={savedCustodyMode}
        registry={registry}
        onBegin={() => {
          if (phase.setup.txCount > 0) {
            onEnsSetup(phase.setup)
            return
          }
          onEnsLink(phase.setup.fullName, { mode: 'simple' })
        }}
        onBack={() => backToSimpleSubdomain(phase.setup.fullName)}
      />
    )
  }

  if (phase.kind === 'simple-create-blocked') {
    return (
      <EnsSetupBlockedScreen
        fallback={phase.fallback}
        onCheckAgain={() => runSimpleCreatePreflight(phase.fallback.fullName)}
        onBack={() => backToSimpleSubdomain(phase.fallback.fullName)}
      />
    )
  }

  if (phase.kind === 'review') {
    const linkOptions: EnsLinkOptions = phase.mode === 'advanced' && phase.ownerAddress && phase.operatorWallet
      ? { mode: 'advanced', ownerAddress: phase.ownerAddress, operatorWallet: phase.operatorWallet }
      : { mode: 'simple' }
    return (
      <ReviewScreen
        fullName={phase.fullName}
        ownerAddress={ownerAddress}
        validation={phase.validation}
        recordsDiff={phase.recordsDiff}
        nextRecords={phase.nextRecords}
        currentEnsName={currentEnsName}
        currentMode={savedCustodyMode}
        registryNetworkLabel={registryNetworkLabel}
        mode={phase.mode}
        onContinue={() => {
          if (recordsDiffHasChanges(phase.recordsDiff)) {
            onEnsRecordsUpdate(phase.fullName, phase.nextRecords, linkOptions, false, phase.currentRecords)
            return
          }
          onEnsLink(phase.fullName, linkOptions)
        }}
        onCheckAgain={() => { void runValidation(phase.fullName, phase.mode, phase.ownerAddress, phase.operatorWallet) }}
        onChange={() => setPhase({ kind: 'pick-parent', mode: phase.mode })}
        onCreate={phase.mode === 'simple' && !phase.validation.ok && phase.validation.reason === 'no-owner'
          ? () => runSimpleCreatePreflight(phase.fullName)
          : undefined}
        onBack={() => backToSimpleSubdomain(phase.fullName)}
      />
    )
  }

  return null
}
