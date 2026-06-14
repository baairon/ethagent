import React from 'react'
import { Box, Text } from 'ink'
import type { Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Spinner } from '../../../ui/Spinner.js'
import { theme } from '../../../ui/theme.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import {
  type CustodyMode,
} from '../custody/state.js'
import { shortAddress } from '../shared/model/format.js'
import {
  emptyAgentEnsRecords,
  recordsHaveCurrentValues,
  unlinkEnsLinkOptions,
} from './editCopy.js'
import {
  EnsSetupRow,
  footerHint,
} from './EnsEditShared.js'
import { UnlinkEnsReviewScreen } from './EnsEditReviewScreens.js'
import {
  DeleteSubdomainTxRunner,
  EscCancel,
} from './EnsEditRunners.js'
import type {
  EnsEditProps,
  EnsPhase,
} from './types.js'

type MaintenanceScreenProps = {
  phase: EnsPhase
  identity: EnsEditProps['identity']
  currentEnsName: string
  currentEnsCanDelete: boolean
  savedCustodyMode: CustodyMode | undefined
  savedOwnerAddress: string
  savedOperator: string
  registryNetworkLabel: string
  validationError: string | null
  ownerAddress: Address
  operatorWalletSession: BrowserWalletReady | null
  setOperatorWalletSession: (session: BrowserWalletReady | null) => void
  setPhase: (phase: EnsPhase) => void
  runDiscovery: () => void
  runUnlinkEnsLoading: (fullName: string) => void
  runDeleteSubdomainPreflight: (fullName: string) => void
  onBack: () => void
  onEnsUnlink: EnsEditProps['onEnsUnlink']
  onEnsRecordsUpdate: EnsEditProps['onEnsRecordsUpdate']
}

export function renderEnsMaintenancePhase({
  phase,
  identity,
  currentEnsName,
  currentEnsCanDelete,
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
}: MaintenanceScreenProps): React.ReactNode | null {
  if (phase.kind === 'mode-select') {
    type EnsAction = 'link' | 'unlink' | 'back'
    const isAdvanced = savedCustodyMode === 'advanced'
    const multiNeedsCustodySetup = isAdvanced && !savedOwnerAddress
    const subtitle = currentEnsName
      ? `This agent resolves at ${currentEnsName}.`
      : 'Assign a name so others can find this agent.'
    const linkHint = multiNeedsCustodySetup
      ? 'Set Advanced custody first via Custody Mode'
      : isAdvanced
        ? 'Root → Name → Apply'
        : 'Root → Name → Apply'
    const options: Array<{ value: EnsAction; role?: 'section' | 'utility'; label: string; hint?: string; disabled?: boolean }> = []
    if (currentEnsName) {
      options.push({ value: 'unlink', label: 'Unlink Name' })
    } else {
      options.push({
        value: 'link',
        label: 'Set Up Name',
        hint: linkHint,
        disabled: multiNeedsCustodySetup,
      })
    }
    options.push({ value: 'back', label: 'Back', role: 'utility' })
    return (
      <Surface
        title="ENS Name"
        subtitle={subtitle}
        footer={footerHint('↵ select · esc back')}
      >
        {validationError ? <Box marginBottom={1}><Text color={theme.accentError}>{validationError}</Text></Box> : null}
        <Box>
          <Select<EnsAction>
            options={options}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'back') return onBack()
              if (choice === 'unlink' && currentEnsName) {
                runUnlinkEnsLoading(currentEnsName)
                return
              }
              if (choice === 'link') {
                if (multiNeedsCustodySetup) return
                runDiscovery()
                return
              }
            }}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'unlink-loading') {
    return (
      <Surface
        title="Prepare ENS Unlink"
        subtitle={`Reading ethagent records from ${phase.fullName}`}
        footer={footerHint('esc back')}
      >
        <Spinner label="reading ENS records..." />
        <EscCancel onCancel={() => setPhase({ kind: 'mode-select' })} />
      </Surface>
    )
  }

  if (phase.kind === 'unlink-review') {
    const options = unlinkEnsLinkOptions(savedCustodyMode, savedOwnerAddress)
    return (
      <UnlinkEnsReviewScreen
        fullName={phase.fullName}
        currentMode={savedCustodyMode}
        registryNetworkLabel={registryNetworkLabel}
        recordsDiff={phase.recordsDiff}
        onUnlink={() => {
          if (recordsHaveCurrentValues(phase.recordsDiff)) {
            onEnsRecordsUpdate(phase.fullName, emptyAgentEnsRecords(), options, true, phase.currentRecords)
            return
          }
          onEnsUnlink()
        }}
        onBack={() => setPhase({ kind: 'mode-select' })}
      />
    )
  }

  if (phase.kind === 'delete-subdomain-preflight') {
    return (
      <Surface
        title="Prepare Subdomain Deletion"
        subtitle={`Verifying the parent of ${phase.fullName} on Ethereum mainnet.`}
        footer={footerHint('esc back')}
      >
        <Spinner label="reading ENS owner..." />
        <EscCancel onCancel={() => setPhase({ kind: 'mode-select' })} />
      </Surface>
    )
  }

  if (phase.kind === 'delete-subdomain-blocked') {
    return (
      <Surface
        title="Cannot Delete Subdomain"
        subtitle={`Onchain check for ${phase.fullName} did not pass.`}
        footer={footerHint('↵ select · esc back')}
      >
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentError}>{phase.reason}</Text>
        </Box>
        <Box>
          <Select<'back'>
            options={[
              { value: 'back', label: 'Back to ENS', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={() => setPhase({ kind: 'mode-select' })}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'delete-subdomain-confirm') {
    const plan = phase.plan
    return (
      <Surface
        title="Delete ENS Subdomain"
        subtitle={`Remove ${plan.fullName} from ${plan.parentName}.`}
        footer={footerHint('↵ select · esc back')}
      >
        <Box flexDirection="column" marginBottom={1}>
          <EnsSetupRow label="Subdomain" value={plan.fullName} />
          <EnsSetupRow label="Parent" value={plan.parentName} />
          <EnsSetupRow label="Owner wallet" value={shortAddress(plan.parentOwnerAddress)} />
          <EnsSetupRow
            label="Path"
            value={plan.parentWrapped ? 'NameWrapper.setSubnodeRecord' : 'Registry.setSubnodeRecord'}
          />
        </Box>
        <Box>
          <Select<'delete' | 'back'>
            options={[
              { value: 'delete', role: 'section', label: 'Action' },
              { value: 'delete', label: 'Delete Subdomain', hint: 'Owner wallet signs' },
              { value: 'back', label: 'Back', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'delete') {
                setPhase({ kind: 'delete-subdomain-tx', plan })
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

  if (phase.kind === 'delete-subdomain-tx') {
    return (
      <DeleteSubdomainTxRunner
        plan={phase.plan}
        ownerAddress={ownerAddress}
        walletSession={operatorWalletSession}
        onWalletReady={setOperatorWalletSession}
        onDeleted={() => {
          onEnsUnlink()
          setPhase({ kind: 'delete-subdomain-done', fullName: phase.plan.fullName })
        }}
        onError={msg => setPhase({ kind: 'delete-subdomain-blocked', fullName: phase.plan.fullName, reason: msg })}
      />
    )
  }

  if (phase.kind === 'delete-subdomain-done') {
    return (
      <Surface
        title="Subdomain Deleted"
        subtitle={`${phase.fullName} is cleared onchain and unlinked from this token.`}
        footer={footerHint('↵ select · esc back')}
      >
        <Box>
          <Select<'back'>
            options={[
              { value: 'back', label: 'Back to ENS', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={() => setPhase({ kind: 'mode-select' })}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  return null
}
