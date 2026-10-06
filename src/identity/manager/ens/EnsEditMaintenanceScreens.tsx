import React from 'react'
import { Box } from 'ink'
import type { Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Spinner } from '../../../ui/Spinner.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import { asSentence } from '../../../ui/text.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import { splitSubdomainName } from '../../ens/ensLookup.js'
import { type CustodyMode } from '../custody/state.js'
import { shortAddress } from '../shared/model/format.js'
import { FieldList } from '../shared/components/FieldRow.js'
import {
  emptyAgentEnsRecords,
  recordsHaveCurrentValues,
  unlinkEnsLinkOptions,
} from './editCopy.js'
import { CheckingScreen, footerHint } from './EnsEditShared.js'
import { UnlinkEnsReviewScreen } from './EnsEditReviewScreens.js'
import {
  DeleteSubdomainTxRunner,
  EscCancel,
} from './EnsEditRunners.js'
import { ensValidationReasonText, selectEnsStatus } from './state.js'
import { agentEnsRecordKeys } from './records.js'
import type {
  EnsEditProps,
  EnsPhase,
} from './types.js'

type MaintenanceScreenProps = {
  phase: EnsPhase
  identity: EnsEditProps['identity']
  currentEnsName: string
  savedCustodyMode: CustodyMode | undefined
  savedOwnerAddress: string
  validationError: string | null
  ownerAddress: Address
  operatorWalletSession: BrowserWalletReady | null
  setOperatorWalletSession: (session: BrowserWalletReady | null) => void
  setPhase: (phase: EnsPhase) => void
  runDiscovery: () => void
  runCheckAgain: () => void
  runUnlinkEnsLoading: (fullName: string) => void
  runDeleteSubdomainPreflight: (fullName: string) => void
  onBack: () => void
  onEnsUnlink: EnsEditProps['onEnsUnlink']
  onEnsRecordsUpdate: EnsEditProps['onEnsRecordsUpdate']
}

const SELECT_FOOTER = footerHint('↵ select · esc back')

export function renderEnsMaintenancePhase({
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
}: MaintenanceScreenProps): React.ReactNode | null {
  const home = () => setPhase({ kind: 'mode-select' })

  if (phase.kind === 'mode-select') {
    type EnsAction = 'link' | 'check' | 'unlink' | 'delete' | 'back'
    const ens = selectEnsStatus(identity)
    const deletable = Boolean(currentEnsName && splitSubdomainName(currentEnsName))
    const needsCustodySetup = savedCustodyMode === 'advanced' && !savedOwnerAddress
    const subtitle = !currentEnsName
      ? 'Name your agent under a .eth you own.'
      : ens.kind === 'issue'
        ? 'This name needs attention.'
        : 'Others can find your agent by this name.'
    const options: Array<{ value: EnsAction; label: string; hint?: string; disabled?: boolean; role?: 'utility' }> = currentEnsName
      ? [
          ...(ens.kind === 'issue' ? [{ value: 'check' as const, label: 'Check Again' }] : []),
          { value: 'unlink', label: 'Unlink Name', hint: 'You keep the name' },
          ...(deletable ? [{ value: 'delete' as const, label: 'Delete Subdomain', hint: 'Removes it onchain' }] : []),
        ]
      : [{
          value: 'link',
          label: 'Choose a Name',
          ...(needsCustodySetup ? { hint: 'Finish Advanced custody setup first', disabled: true } : {}),
        }]
    options.push({ value: 'back', label: 'Back', role: 'utility' })
    return (
      <Surface title="ENS Name" subtitle={subtitle} footer={SELECT_FOOTER}>
        {currentEnsName ? (
          <FieldList fields={[
            { label: 'Name', value: currentEnsName, valueColor: ens.kind === 'issue' ? theme.accentError : theme.accentPeriwinkle },
            ens.kind === 'issue'
              ? { label: 'Problem', value: `${ensValidationReasonText(ens.reason)}.`, valueColor: theme.accentError }
              : { label: 'Status', value: identity.agentId ? `Linked to token #${identity.agentId}` : 'Linked' },
          ]} />
        ) : null}
        {validationError ? (
          <Box marginTop={currentEnsName ? 1 : 0}><Paragraph color={theme.accentError}>{validationError}</Paragraph></Box>
        ) : null}
        <Box marginTop={currentEnsName || validationError ? 1 : 0}>
          <Select<EnsAction>
            options={options}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'back') return onBack()
              if (choice === 'check') return runCheckAgain()
              if (choice === 'unlink' && currentEnsName) return runUnlinkEnsLoading(currentEnsName)
              if (choice === 'delete' && currentEnsName) return runDeleteSubdomainPreflight(currentEnsName)
              if (choice === 'link' && !needsCustodySetup) return runDiscovery()
            }}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'unlink-loading') {
    return (
      <CheckingScreen title={`Unlink ${phase.fullName}`} subtitle="Reading its agent records on Ethereum Mainnet.">
        <Spinner label="Reading records…" />
        <EscCancel onCancel={home} />
      </CheckingScreen>
    )
  }

  if (phase.kind === 'unlink-review') {
    const options = unlinkEnsLinkOptions(savedCustodyMode, savedOwnerAddress)
    return (
      <UnlinkEnsReviewScreen
        fullName={phase.fullName}
        recordsDiff={phase.recordsDiff}
        onUnlink={() => {
          if (recordsHaveCurrentValues(phase.recordsDiff)) {
            onEnsRecordsUpdate(phase.fullName, emptyAgentEnsRecords(), options, true, phase.currentRecords)
            return
          }
          onEnsUnlink()
        }}
        onBack={home}
      />
    )
  }

  if (phase.kind === 'delete-subdomain-preflight') {
    return (
      <CheckingScreen title={`Delete ${phase.fullName}`} subtitle="Confirming who manages its parent name.">
        <Spinner label="Reading the parent name…" />
        <EscCancel onCancel={home} />
      </CheckingScreen>
    )
  }

  if (phase.kind === 'delete-subdomain-blocked') {
    return (
      <Surface title={`Can't Delete ${phase.fullName}`} subtitle={asSentence(phase.reason)} footer={SELECT_FOOTER} tone="error">
        <Select<'back'>
          options={[{ value: 'back', label: 'Back', role: 'utility' }]}
          hintLayout="inline"
          onSubmit={home}
          onCancel={home}
        />
      </Surface>
    )
  }

  if (phase.kind === 'delete-subdomain-confirm') {
    const plan = phase.plan
    return (
      <Surface
        title={`Delete ${plan.fullName}?`}
        subtitle={`Removes it from ${plan.parentName}. Your wallet approves the deletion on Ethereum Mainnet, then a snapshot save drops it from your agent.`}
        footer={SELECT_FOOTER}
        tone="error"
      >
        <FieldList fields={[
          { label: 'Subdomain', value: plan.fullName },
          { label: 'Parent', value: plan.parentName },
          { label: 'Signs with', value: `Owner wallet ${shortAddress(plan.parentOwnerAddress)}` },
        ]} />
        <Box marginTop={1}>
          <Select<'delete' | 'back'>
            options={[
              { value: 'delete', label: 'Delete Subdomain' },
              { value: 'back', label: 'Back', role: 'utility' },
            ]}
            initialIndex={1}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'delete') {
                setPhase({ kind: 'delete-subdomain-tx', plan })
                return
              }
              home()
            }}
            onCancel={home}
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
        recordKeys={identity.identityRegistryAddress ? agentEnsRecordKeys(identity.identityRegistryAddress, identity.agentId) : []}
        walletSession={operatorWalletSession}
        onWalletReady={setOperatorWalletSession}
        onDeleted={onEnsUnlink}
        onError={msg => setPhase({ kind: 'delete-subdomain-blocked', fullName: phase.plan.fullName, reason: msg })}
        onCancel={home}
      />
    )
  }

  return null
}
