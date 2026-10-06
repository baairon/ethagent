import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import { asSentence, plural } from '../../../ui/text.js'
import type { AgentRecordDiff } from '../../ens/agentRecords.js'
import type { EnsValidation } from '../../ens/ensLookup.js'
import type {
  EnsSetupBlockedPlan,
  EnsSetupPlan,
} from '../../ens/ensAutomation.js'
import { ensValidationReasonText } from './state.js'
import { shortAddress } from '../shared/model/format.js'
import { FieldList } from '../shared/components/FieldRow.js'
import {
  describeCurrentRecords,
  describeRecordChanges,
  manualReasonTitle,
} from './editCopy.js'
import { footerHint } from './EnsEditShared.js'

const FOOTER = footerHint('↵ select · esc back')

function gasLine(txCount: number): string {
  return txCount === 1
    ? 'One wallet transaction on Ethereum Mainnet. It needs gas.'
    : `${plural(txCount, 'wallet transaction')} on Ethereum Mainnet. Each needs gas.`
}

type EnsSetupReviewScreenProps = {
  setup: EnsSetupPlan
  currentEnsName: string
  onBegin: () => void
  onChange: () => void
  onBack: () => void
}

export const EnsSetupReviewScreen: React.FC<EnsSetupReviewScreenProps> = ({
  setup,
  currentEnsName,
  onBegin,
  onChange,
  onBack,
}) => {
  type Action = 'begin' | 'change' | 'back'
  const creates = setup.registryAction === 'create-subdomain' || setup.registryAction === 'create-wrapped-subdomain'
  const records = describeRecordChanges(setup.recordDiffs)
  const signer = setup.mode === 'simple' ? 'Connected wallet' : 'Owner wallet'
  return (
    <Surface
      title={creates ? `Create ${setup.fullName}` : `Set Up ${setup.fullName}`}
      subtitle={setup.txCount > 0 ? gasLine(setup.txCount) : 'No transaction needed. This only links the name to your agent.'}
      footer={FOOTER}
    >
      <FieldList fields={[
        { label: 'Name', value: setup.fullName, valueColor: theme.accentPeriwinkle },
        { label: 'Points to', value: `${shortAddress(setup.addressRecord.next)}${setup.addressRecord.changed ? '' : ' (already set)'}` },
        { label: 'Records', value: records.length > 0 ? records.join('\n') : 'Already set' },
        { label: 'Signs with', value: `${signer} ${shortAddress(setup.ownerAddress)}` },
        currentEnsName && currentEnsName !== setup.fullName ? { label: 'Replaces', value: currentEnsName } : null,
      ]} />
      {setup.registryAction === 'none' ? (
        <Box marginTop={1}><Paragraph color={theme.dim}>This subdomain exists from an earlier attempt and will be reused.</Paragraph></Box>
      ) : null}
      {setup.warnings.map(warning => (
        <Box key={warning} marginTop={1}><Paragraph color={theme.accentError}>{warning}</Paragraph></Box>
      ))}
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'begin', label: creates ? 'Create Name' : setup.txCount > 0 ? 'Set Up Name' : 'Link Name' },
            { value: 'change', label: 'Choose Another Name' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'begin') return onBegin()
            if (choice === 'change') return onChange()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type EnsSetupBlockedScreenProps = {
  fallback: EnsSetupBlockedPlan
  onCheckAgain: () => void
  onChange: () => void
  onBack: () => void
}

export const EnsSetupBlockedScreen: React.FC<EnsSetupBlockedScreenProps> = ({
  fallback,
  onCheckAgain,
  onChange,
  onBack,
}) => {
  type Action = 'check' | 'change' | 'back'
  const title = manualReasonTitle(fallback.reason)
  return (
    <Surface title={`Can't Set Up ${fallback.fullName}`} subtitle={title} footer={FOOTER} tone="error">
      {fallback.detail && asSentence(fallback.detail) !== title ? <Paragraph color={theme.dim}>{asSentence(fallback.detail)}</Paragraph> : null}
      {fallback.mode === 'advanced' ? (
        <Box marginTop={fallback.detail ? 1 : 0}>
          <Paragraph color={theme.textSubtle}>The owner wallet signs the ENS records and must hold the token during setup. Afterwards the token can go back into the Vault. Operator wallets never control the name.</Paragraph>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'check', label: 'Check Again' },
            { value: 'change', label: 'Choose Another Name' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'check') return onCheckAgain()
            if (choice === 'change') return onChange()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type UnlinkEnsReviewScreenProps = {
  fullName: string
  recordsDiff: AgentRecordDiff[]
  onUnlink: () => void
  onBack: () => void
}

export const UnlinkEnsReviewScreen: React.FC<UnlinkEnsReviewScreenProps> = ({
  fullName,
  recordsDiff,
  onUnlink,
  onBack,
}) => {
  type Action = 'unlink' | 'back'
  const records = describeCurrentRecords(recordsDiff)
  return (
    <Surface
      title={`Unlink ${fullName}`}
      subtitle={records.length > 0
        ? 'You keep the name. One wallet transaction on Ethereum Mainnet clears its agent records.'
        : 'You keep the name. Its records are already clear, so only your agent profile changes.'}
      footer={FOOTER}
    >
      {records.length > 0 ? <FieldList fields={[{ label: 'Records', value: records.join('\n') }]} /> : null}
      <Box marginTop={records.length > 0 ? 1 : 0}>
        <Select<Action>
          options={[
            { value: 'unlink', label: 'Unlink Name' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          initialIndex={1}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'unlink') return onUnlink()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type ReviewScreenProps = {
  fullName: string
  validation: EnsValidation
  recordsDiff: AgentRecordDiff[]
  currentEnsName: string
  onContinue: () => void
  onCheckAgain: () => void
  onChange: () => void
  onBack: () => void
}

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  fullName,
  validation,
  recordsDiff,
  currentEnsName,
  onContinue,
  onCheckAgain,
  onChange,
  onBack,
}) => {
  type ReviewAction = 'continue' | 'check-again' | 'change' | 'back'

  if (!validation.ok) {
    const reason = ensValidationReasonText(validation.reason)
    const showDetail = validation.detail && validation.detail !== reason
    return (
      <Surface title="Name Needs Attention" subtitle={`${reason}.`} footer={FOOTER} tone="error">
        <FieldList fields={[{ label: 'Name', value: fullName }]} />
        {showDetail ? <Paragraph color={theme.dim}>{validation.detail!}</Paragraph> : null}
        <Box marginTop={1}>
          <Select<ReviewAction>
            options={[
              { value: 'check-again', label: 'Check Again' },
              { value: 'change', label: 'Choose Another Name' },
              { value: 'back', label: 'Back', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'check-again') return onCheckAgain()
              if (choice === 'change') return onChange()
              return onBack()
            }}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  const records = describeRecordChanges(recordsDiff)
  return (
    <Surface
      title={`Link ${fullName}`}
      subtitle={records.length > 0 ? gasLine(1) : 'The records already match. Only your agent profile changes.'}
      footer={FOOTER}
    >
      <FieldList fields={[
        { label: 'Name', value: fullName, valueColor: theme.accentPeriwinkle },
        records.length > 0 ? { label: 'Records', value: records.join('\n') } : null,
        currentEnsName && currentEnsName !== fullName ? { label: 'Replaces', value: currentEnsName } : null,
      ]} />
      <Box marginTop={1}>
        <Select<ReviewAction>
          options={[
            { value: 'continue', label: 'Link Name' },
            { value: 'change', label: 'Choose Another Name' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'continue') return onContinue()
            if (choice === 'change') return onChange()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}
