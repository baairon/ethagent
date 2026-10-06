import React from 'react'
import { Box } from 'ink'
import { type Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../ui/Select.js'
import { Spinner } from '../../../ui/Spinner.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import {
  isEthDomain,
  normalizeEthDomain,
} from '../../ens/ensLookup.js'
import { isRootEthName } from '../../ens/ensAutomation.js'
import { shortAddress } from '../shared/model/format.js'
import {
  recordsDiffHasChanges,
  type EnsLinkOptions,
} from './editCopy.js'
import { openExternalUrl } from '../../../utils/openExternal.js'
import { TextInput } from '../../../ui/TextInput.js'
import {
  CheckingName,
  CheckingScreen,
  footerHint,
  SubdomainEntry,
} from './EnsEditShared.js'
import {
  EnsSetupBlockedScreen,
  EnsSetupReviewScreen,
  ReviewScreen,
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
}

export function renderSimpleEnsPhase({
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
}: SimpleScreenProps): React.ReactNode | null {
  const pickParent = (mode?: 'simple' | 'advanced') => {
    if (discovery.status === 'idle') return runDiscovery(mode === 'advanced' ? 'advanced' : 'simple')
    setPhase({ kind: 'pick-parent', ...(mode === 'advanced' ? { mode } : {}) })
  }

  if (phase.kind === 'discovering' || discovery.status === 'loading') {
    return (
      <CheckingScreen title="Choose a Name" subtitle={`Finding .eth names owned by ${shortAddress(ownerAddress)}.`}>
        <Spinner label="Looking up your ENS names…" startedAt={discoveryStartedAt} />
        <EscCancel onCancel={cancelDiscoveryToModeSelect} />
      </CheckingScreen>
    )
  }

  if (phase.kind === 'pick-parent') {
    type DomainAction = `pick:${string}` | 'open-ens-domains' | 'manual' | 'retry' | 'back'
    const advancedMode = phase.mode === 'advanced'
    const ownedNames = discovery.status === 'ok' || discovery.status === 'error' ? discovery.names : []
    const noOwnedNames = discovery.status === 'ok' && ownedNames.length === 0
    const errors = [
      validationError,
      phase.error,
      discovery.status === 'error' ? `Your names could not be looked up. ${discovery.message}` : null,
    ].filter((line): line is string => Boolean(line))
    const subtitle = noOwnedNames
      ? `No .eth names found for ${shortAddress(ownerAddress)}.`
      : advancedMode
        ? `Pick a .eth name your owner wallet ${shortAddress(ownerAddress)} manages.`
        : 'Your agent gets a subdomain under a .eth name you own.'

    const options: Array<SelectOption<DomainAction>> = [
      ...ownedNames.map(name => ({ value: `pick:${name}` as DomainAction, label: name })),
      ...(discovery.status === 'error' ? [{ value: 'retry' as DomainAction, label: 'Try Again' }] : []),
      { value: 'manual', label: 'Type a Name', ...(ownedNames.length > 0 ? { hint: 'Not in the list' } : {}) },
      { value: 'open-ens-domains', label: 'Register a .eth Name', hint: 'Opens the ENS app' },
      { value: 'back', label: 'Back', role: 'utility' },
    ]

    return (
      <Surface title="Choose a Name" subtitle={subtitle} footer={footerHint('↵ select · esc back')}>
        {errors.map(line => <Paragraph key={line} color={theme.accentError}>{line}</Paragraph>)}
        {discovery.status === 'ok' && discovery.warning ? <Paragraph color={theme.dim}>{discovery.warning}</Paragraph> : null}
        <Box marginTop={errors.length > 0 || (discovery.status === 'ok' && discovery.warning) ? 1 : 0}>
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
        title="Type a Name"
        subtitle={advancedMode
          ? `Enter a .eth name your owner wallet ${shortAddress(ownerAddress)} manages.`
          : 'Enter a .eth name you own.'}
        footer={footerHint('↵ continue · esc back')}
      >
        {phase.error ? <Box marginBottom={1}><Paragraph color={theme.accentError}>{phase.error}</Paragraph></Box> : null}
        <TextInput
          key={`edit-ens-parent-manual-${advancedMode ? 'advanced' : 'simple'}`}
          placeholder="name.eth"
          validate={value => {
            const v = normalizeEthDomain(value)
            if (!v) return 'Enter a .eth name.'
            if (!isEthDomain(v)) return 'That is not a valid .eth name.'
            if (!isRootEthName(v)) return 'Enter the top-level name only, with no subdomain.'
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
          onCancel={() => pickParent(advancedMode ? 'advanced' : 'simple')}
        />
      </Surface>
    )
  }

  if (phase.kind === 'pick-subdomain') {
    return (
      <SubdomainEntry
        parent={phase.parent}
        pointsTo={ownerAddress}
        initialValue={phase.label}
        error={phase.error}
        onConfirm={label => { void runValidation(`${label}.${phase.parent}`, 'simple') }}
        onBack={() => pickParent()}
      />
    )
  }

  if (phase.kind === 'validating') {
    return <CheckingName fullName={phase.fullName} onCancel={() => backToSimpleSubdomain(phase.fullName)} />
  }

  if (phase.kind === 'simple-create-preflight') {
    return <CheckingName fullName={phase.fullName} onCancel={() => backToSimpleSubdomain(phase.fullName)} />
  }

  if (phase.kind === 'simple-create-review') {
    return (
      <EnsSetupReviewScreen
        setup={phase.setup}
        currentEnsName={currentEnsName}
        onBegin={() => {
          if (phase.setup.txCount > 0) {
            onEnsSetup(phase.setup)
            return
          }
          onEnsLink(phase.setup.fullName, { mode: 'simple' })
        }}
        onChange={() => pickParent()}
        onBack={() => backToSimpleSubdomain(phase.setup.fullName)}
      />
    )
  }

  if (phase.kind === 'simple-create-blocked') {
    return (
      <EnsSetupBlockedScreen
        fallback={phase.fallback}
        onCheckAgain={() => runSimpleCreatePreflight(phase.fallback.fullName)}
        onChange={() => pickParent()}
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
        validation={phase.validation}
        recordsDiff={phase.recordsDiff}
        currentEnsName={currentEnsName}
        onContinue={() => {
          if (recordsDiffHasChanges(phase.recordsDiff)) {
            onEnsRecordsUpdate(phase.fullName, phase.nextRecords, linkOptions, false, phase.currentRecords)
            return
          }
          onEnsLink(phase.fullName, linkOptions)
        }}
        onCheckAgain={() => { void runValidation(phase.fullName, phase.mode, phase.ownerAddress, phase.operatorWallet) }}
        onChange={() => pickParent(phase.mode)}
        onBack={() => phase.fullName === currentEnsName ? setPhase({ kind: 'mode-select' }) : backToSimpleSubdomain(phase.fullName)}
      />
    )
  }

  return null
}
