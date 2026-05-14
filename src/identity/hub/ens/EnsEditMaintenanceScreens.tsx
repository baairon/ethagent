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
      : 'Link an ENS name so others can find this agent by name instead of token ID.'
    const linkHint = multiNeedsCustodySetup
      ? 'Set Advanced custody first via Custody Mode'
      : isAdvanced
        ? 'Walks you through Root, Name, Review, and Apply'
        : 'Walks you through Root, Name, Review, and Apply'
    const options: Array<{ value: EnsAction; role?: 'section' | 'utility'; label: string; hint?: string; disabled?: boolean }> = []
    if (currentEnsName) {
      options.push({ value: 'unlink', label: 'Unlink Name', hint: 'Removes this name from the token. Set up a different name afterward by linking again.' })
    } else {
      options.push({
        value: 'link',
        label: 'Set Up Name',
        hint: linkHint,
        disabled: multiNeedsCustodySetup,
      })
    }
    options.push({ value: 'back', role: 'section', label: 'Navigation' })
    options.push({ value: 'back', label: 'Back', hint: 'Return to Identity Hub', role: 'utility' })
    return (
      <Surface
        title="ENS Name"
        subtitle={subtitle}
        footer={footerHint('enter select · esc back')}
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
                if (isAdvanced && savedOwnerAddress) {
                  setPhase({ kind: 'advanced-transfer-check' })
                  return
                }
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
        <Spinner label="reading current ENS record values..." />
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
        <Spinner label="reading parent owner from ENS..." />
        <EscCancel onCancel={() => setPhase({ kind: 'mode-select' })} />
      </Surface>
    )
  }

  if (phase.kind === 'delete-subdomain-blocked') {
    return (
      <Surface
        title="Cannot Delete Subdomain"
        subtitle={`Onchain check for ${phase.fullName} did not pass.`}
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentError}>{phase.reason}</Text>
        </Box>
        <Box>
          <Select<'back'>
            options={[
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back to ENS', hint: 'Return to ENS menu', role: 'utility' },
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
        subtitle={`Clear the onchain entry for ${plan.fullName} at ${plan.parentName}.`}
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column" marginBottom={1}>
          <EnsSetupRow label="Subdomain" value={plan.fullName} />
          <EnsSetupRow label="Parent" value={plan.parentName} />
          <EnsSetupRow label="Owner wallet" value={shortAddress(plan.parentOwnerAddress)} />
          <EnsSetupRow
            label="Path"
            value={plan.parentWrapped ? 'NameWrapper.setSubnodeRecord' : 'Registry.setSubnodeRecord'}
          />
          <EnsSetupRow
            label="What changes"
            value="Onchain: subdomain owner and resolver set to 0. Locally: this token unlinks from the name."
          />
        </Box>
        <Box>
          <Select<'delete' | 'back'>
            options={[
              { value: 'delete', role: 'section', label: 'Action' },
              { value: 'delete', label: 'Delete Subdomain', hint: 'Sign with the owner wallet to clear the onchain entry' },
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back', hint: 'Return to ENS menu', role: 'utility' },
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
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.text}>The label is freed for reuse on the parent name.</Text>
        </Box>
        <Box>
          <Select<'back'>
            options={[
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back to ENS', hint: 'Return to ENS menu', role: 'utility' },
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
