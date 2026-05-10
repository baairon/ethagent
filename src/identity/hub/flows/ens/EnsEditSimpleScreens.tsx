import React from 'react'
import { Box, Text } from 'ink'
import { formatEther, type Address } from 'viem'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { Spinner } from '../../../../ui/Spinner.js'
import { theme } from '../../../../ui/theme.js'
import {
  createMainnetClient,
  isEthDomain,
  normalizeEthDomain,
} from '../../../ens/ensLookup.js'
import {
  generateRegistrationSecret,
  ONE_YEAR_SECONDS,
  readNameAvailable,
  readRentPrice,
  validateRegistrableName,
} from '../../../ens/ensRegistration.js'
import { isRootEthName } from '../../../ens/ensAutomation.js'
import type { Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'
import {
  readIdentityStateString,
  type CustodyMode,
} from '../../model/custody.js'
import { shortAddress } from '../../model/format.js'
import {
  recordsDiffHasChanges,
  type EnsLinkOptions,
} from './ensEditCopy.js'
import {
  EnsSetupRow,
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
import {
  EscCancel,
  RegisterRootCommitRunner,
  RegisterRootTxRunner,
  RegisterRootWaitScreen,
} from './EnsEditRunners.js'
import type {
  DiscoveryState,
  EnsEditProps,
  EnsPhase,
} from './ensEditTypes.js'

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
  runDiscovery: () => void
  runValidation: (fullName: string, mode: 'simple' | 'advanced', phaseOwnerAddress?: Address, operatorWallet?: Address) => Promise<void>
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
    type DomainAction = `pick:${string}` | 'register-root' | 'manual' | 'retry' | 'back'
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
      { value: 'register-root' as DomainAction, role: 'section' as const, label: 'Get a New One' },
      { value: 'register-root' as DomainAction, label: 'Register New ENS Name', hint: 'Register an ENS name through ENS to use as a root' },
      ...(noOwnedNames
        ? [{ value: 'retry' as DomainAction, label: 'Scan Again', hint: 'Retry the search after registering' }]
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

    return (
      <Surface
        title="Assign ENS Name"
        subtitle="Choose a root .eth name, then create a dedicated agent subdomain under it."
        footer={footerHint('enter select · esc back')}
      >
        <EnsStatusBanner identity={identity} noRootEnsName={noOwnedNames} />
        {validationError ? <Text color={theme.accentError}>{validationError}</Text> : null}
        {errorMessage ? <Text color={theme.accentError}>{errorMessage}: {discovery.status === 'error' ? discovery.message : ''}</Text> : null}
        {warningMessage ? <Text color={theme.accentPeriwinkle}>{warningMessage}</Text> : null}
        <Box marginTop={1}>
          <Select<DomainAction>
            options={options}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'back') return setPhase({ kind: 'mode-select' })
              if (choice === 'manual') { setPhase({ kind: 'manual-parent' }); return }
              if (choice === 'register-root') { setPhase({ kind: 'register-root-input' }); return }
              if (choice === 'retry') {
                runDiscovery()
                return
              }
              if (choice.startsWith('pick:')) {
                const name = choice.slice('pick:'.length)
                if (name) setPhase({ kind: 'pick-subdomain', parent: name })
              }
            }}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'register-root-input') {
    return (
      <Surface
        title="Register an ENS Name"
        subtitle="Pick a name to register on Ethereum mainnet for 1 year. The connected wallet pays and becomes the owner."
        footer={footerHint('enter continues · esc back')}
      >
        {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        <Box marginTop={1}>
          <TextInput
            placeholder="myname"
            validate={value => {
              const result = validateRegistrableName(value)
              return result.ok ? null : result.detail
            }}
            onSubmit={value => {
              const result = validateRegistrableName(value)
              if (!result.ok) {
                setPhase({ kind: 'register-root-input', error: result.detail })
                return
              }
              const secret = generateRegistrationSecret()
              setPhase({ kind: 'register-root-pricing', label: result.label, secret, busy: true })
              const client = createMainnetClient()
              Promise.all([
                readNameAvailable(client, result.label),
                readRentPrice(client, result.label, BigInt(ONE_YEAR_SECONDS)),
              ])
                .then(([available, price]) => {
                  if (!available) {
                    setPhase({ kind: 'register-root-input', error: `${result.label}.eth is already registered. Pick a different name.` })
                    return
                  }
                  setPhase({ kind: 'register-root-pricing', label: result.label, secret, busy: false, price })
                })
                .catch((err: unknown) => {
                  setPhase({ kind: 'register-root-input', error: err instanceof Error ? err.message : String(err) })
                })
            }}
            onCancel={() => setPhase({ kind: 'pick-parent' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'register-root-pricing') {
    const fullName = `${phase.label}.eth`
    if (phase.busy || !phase.price) {
      return (
        <Surface
          title="Register an ENS Name"
          subtitle={`Checking availability and price for ${fullName}...`}
          footer={footerHint('esc back')}
        >
          <Box marginTop={1}><Text color={theme.textSubtle}>Reading from Ethereum mainnet...</Text></Box>
        </Surface>
      )
    }
    const totalEth = formatEther(phase.price.total)
    const baseEth = formatEther(phase.price.base)
    const premiumEth = formatEther(phase.price.premium)
    return (
      <Surface
        title="Register an ENS Name"
        subtitle={`${fullName} is available. Review the cost and continue with two transactions.`}
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column">
          <EnsSetupRow label="Name" value={fullName} />
          <EnsSetupRow label="Owner" value={shortAddress(ownerAddress)} />
          <EnsSetupRow label="Duration" value="1 year" />
          <EnsSetupRow label="Rent" value={`${baseEth} ETH`} />
          {phase.price.premium > 0n ? <EnsSetupRow label="Premium" value={`${premiumEth} ETH`} /> : null}
          <EnsSetupRow label="Total" value={`${totalEth} ETH`} />
          <Box marginTop={1}><Text color={theme.dim}>Two transactions: a commit, a 60-second wait, then the registration. Keep this tab open through both.</Text></Box>
          <Box marginTop={1}><Text color={theme.dim}>Manage renewals on https://app.ens.domains/ before the year is up.</Text></Box>
        </Box>
        <Box marginTop={1}>
          <Select<'commit' | 'pick-different' | 'back'>
            options={[
              { value: 'commit', role: 'section', label: 'Continue' },
              { value: 'commit', label: 'Continue to Commit', hint: 'Sign the first transaction' },
              { value: 'pick-different', label: 'Pick a Different Name', hint: 'Return to name input' },
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back', hint: 'Return to root selection', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'commit') {
                setPhase({ kind: 'register-root-commit-tx', label: phase.label, secret: phase.secret, price: phase.price! })
                return
              }
              if (choice === 'pick-different') return setPhase({ kind: 'register-root-input' })
              setPhase({ kind: 'pick-parent' })
            }}
            onCancel={() => setPhase({ kind: 'pick-parent' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'register-root-commit-tx') {
    return (
      <RegisterRootCommitRunner
        phase={phase}
        ownerAddress={ownerAddress}
        walletSession={operatorWalletSession}
        onWalletReady={setOperatorWalletSession}
        onCommitted={() => setPhase({ kind: 'register-root-wait', label: phase.label, secret: phase.secret, price: phase.price, commitMinedAt: Date.now() })}
        onError={msg => setPhase({ kind: 'register-root-input', error: msg })}
      />
    )
  }

  if (phase.kind === 'register-root-wait') {
    return (
      <RegisterRootWaitScreen
        phase={phase}
        onReady={() => setPhase({ kind: 'register-root-tx', label: phase.label, secret: phase.secret, price: phase.price })}
        onCancel={() => setPhase({ kind: 'register-root-input', error: 'Commit cancelled. Names must be re-committed; secrets do not carry over.' })}
      />
    )
  }

  if (phase.kind === 'register-root-tx') {
    return (
      <RegisterRootTxRunner
        phase={phase}
        ownerAddress={ownerAddress}
        walletSession={operatorWalletSession}
        onWalletReady={setOperatorWalletSession}
        onRegistered={() => setPhase({ kind: 'register-root-done', fullName: `${phase.label}.eth` })}
        onError={msg => setPhase({ kind: 'register-root-input', error: msg })}
      />
    )
  }

  if (phase.kind === 'register-root-done') {
    return (
      <Surface
        title="ENS Name Registered"
        subtitle={`${phase.fullName} is now owned by ${shortAddress(ownerAddress)}.`}
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.text}>Manage renewals and other settings on https://app.ens.domains/ before the year is up.</Text>
          <Text color={theme.dim}>The name will appear in the picker on the next scan.</Text>
        </Box>
        <Box marginTop={1}>
          <Select<'scan' | 'back'>
            options={[
              { value: 'scan', role: 'section', label: 'Next' },
              { value: 'scan', label: 'Scan Again', hint: 'Re-run root ENS name discovery' },
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back to ENS', hint: 'Return to ENS menu', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'scan') {
                runDiscovery()
                return
              }
              setPhase({ kind: 'mode-select' })
            }}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'manual-parent') {
    return (
      <Surface
        title="Your Root .eth Name"
        subtitle="Type the root .eth name you own. Your agent becomes a subdomain of it."
        footer={footerHint('enter continues · esc back')}
      >
        {statusBanner}
        <Box marginTop={1}>
          <Text color={theme.dim}>Only root .eth names on Ethereum mainnet are supported.</Text>
        </Box>
        <TextInput
          key="edit-ens-parent-manual"
          placeholder="e.g. name.eth"
          validate={value => {
            const v = normalizeEthDomain(value)
            if (!v) return 'Enter a .eth name'
            if (!isEthDomain(v)) return 'Must be a valid .eth name'
            if (!isRootEthName(v)) return 'Enter a root .eth name, e.g. name.eth'
            return null
          }}
          onSubmit={value => setPhase({ kind: 'pick-subdomain', parent: normalizeEthDomain(value) })}
          onCancel={() => setPhase({ kind: 'pick-parent' })}
        />
      </Surface>
    )
  }

  if (phase.kind === 'pick-subdomain') {
    return (
      <SubdomainEntry
        parent={phase.parent}
        ownerAddress={ownerAddress}
        suggestion={phase.label || agentNameSuggestion}
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
        onChange={() => setPhase(phase.mode === 'advanced' ? { kind: 'advanced-transfer-check' } : { kind: 'pick-parent' })}
        onCreate={phase.mode === 'simple' && !phase.validation.ok && phase.validation.reason === 'no-owner'
          ? () => runSimpleCreatePreflight(phase.fullName)
          : undefined}
        onBack={() => backToSimpleSubdomain(phase.fullName)}
      />
    )
  }

  return null
}
