import React from 'react'
import { Box } from 'ink'
import { theme } from '../../../../ui/theme.js'
import { Surface } from '../../../../ui/Surface.js'
import { Paragraph } from '../../../../ui/Paragraph.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { useContentWidth } from '../../../../ui/layout.js'
import { middleEllipsis } from '../../../../ui/text.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import { copyableIdentityFields } from '../model/copy.js'
import { identityNetworkName } from '../model/network.js'
import { shortAddress } from '../model/format.js'
import { displayCustodyMode, readCustodyMode } from '../../custody/state.js'
import { hasPendingPublish } from '../../continuity/state.js'
import { lastBackupLabel } from '../../profile/identity.js'
import { transferSnapshotView } from '../../transfer/state.js'
import { FieldList } from './FieldRow.js'

type CopyAction = `copy:${string}` | 'back'

type DetailsScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  copyNotice?: string | null
  unlinked?: boolean
  onchainOwner?: string
  footer: React.ReactNode
  onCopy: (label: string, value: string) => void
  onBack: () => void
}

const CURSOR_AND_GAP = 4

export const DetailsScreen: React.FC<DetailsScreenProps> = ({
  identity,
  config,
  copyNotice,
  unlinked,
  onchainOwner,
  footer,
  onCopy,
  onBack,
}) => {
  const contentWidth = useContentWidth()
  const copyable = copyableIdentityFields(identity, config)
  const labelWidth = Math.max(0, ...copyable.map(field => field.label.length))
  const valueBudget = Math.max(16, contentWidth - labelWidth - CURSOR_AND_GAP)
  const options: Array<SelectOption<CopyAction>> = [
    ...copyable.map(field => ({
      value: `copy:${field.label}` as const,
      label: field.label,
      hint: fitValue(field.value, valueBudget),
    })),
    ...(copyable.length === 0 ? [{ value: 'back' as const, role: 'notice' as const, label: 'No values yet.' }] : []),
    { value: 'back', label: 'Back', role: 'utility' },
  ]

  const owner = copyable.find(field => field.label === 'Owner Wallet')?.value
  const transfer = transferSnapshotView(identity)
  const network = identity?.agentId ? identityNetworkName(identity, config) : null
  const lastSaved = lastBackupLabel(identity)
  const subtitle = copyNotice
    ?? (unlinked ? 'Token unlinked. Values kept for reference.' : 'Select a value to copy it.')

  return (
    <Surface title="Token Values" subtitle={<Paragraph color={copyNotice ? theme.accentPeriwinkle : theme.menuStatus}>{subtitle}</Paragraph>} footer={footer}>
      {identity ? (
        <FieldList fields={[
          network ? { label: 'Network', value: network } : null,
          { label: 'Custody', value: displayCustodyMode(readCustodyMode(identity.state)) },
          { label: 'Last Saved', value: lastSaved === 'never' ? 'Never' : lastSaved, ...(lastSaved === 'never' ? { valueColor: theme.dim } : {}) },
          hasPendingPublish(identity) ? { label: 'Pending', value: 'Saved locally, not yet onchain' } : null,
          onchainOwner && owner && onchainOwner.toLowerCase() !== owner.toLowerCase()
            ? { label: 'Onchain Owner', value: shortAddress(onchainOwner), valueColor: theme.accentError }
            : null,
          transfer
            ? {
                label: 'Transfer',
                value: `${transfer.kind === 'ready-to-transfer' ? 'Snapshot ready for' : 'Snapshot received for'} ${shortAddress(transfer.receiver)}${transfer.receiverHandle && transfer.receiverHandle !== transfer.receiver ? ` (${transfer.receiverHandle})` : ''}`,
              }
            : null,
        ]} />
      ) : null}
      <Box marginTop={identity ? 1 : 0}>
        <Select<CopyAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'back') return onBack()
            const label = choice.slice('copy:'.length)
            const found = copyable.find(field => field.label === label)
            if (found) onCopy(found.label, found.value)
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

function fitValue(value: string, budget: number): string {
  if (value.length <= budget) return value
  const tail = Math.min(8, Math.floor((budget - 1) / 3))
  return middleEllipsis(value, budget - tail - 1, tail)
}
