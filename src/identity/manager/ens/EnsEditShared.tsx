import React from 'react'
import { Box, Text } from 'ink'
import type { Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { TextInput } from '../../../ui/TextInput.js'
import { Spinner } from '../../../ui/Spinner.js'
import { theme } from '../../../ui/theme.js'
import { sanitizeSubdomainPrefix } from '../../ens/ensLookup.js'
import { shortAddress } from '../shared/model/format.js'
import { FieldList } from '../shared/components/FieldRow.js'
import { EscCancel } from './EnsEditRunners.js'

export const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

export function rootErrorMessage(
  reason: 'invalid-root' | 'missing-token-id' | 'root-not-owned' | 'wrapped-parent' | 'root-owner-mismatch' | 'token-owner-mismatch' | 'token-owner-lookup-failed' | 'lookup-failed',
  detail: string,
  rootName: string,
): string {
  const extra = detail ? ` ${detail}` : ''
  switch (reason) {
    case 'invalid-root':
      return 'Enter a top-level .eth name.'
    case 'missing-token-id':
      return 'This agent has no token id yet.'
    case 'root-not-owned':
      return `This wallet does not manage ${rootName} on Ethereum Mainnet. Switch wallets or choose another name.`
    case 'wrapped-parent':
      return `The NameWrapper owner of ${rootName} could not be confirmed.${extra}`
    case 'root-owner-mismatch':
      return `This wallet does not manage ${rootName}.${extra}`
    case 'token-owner-mismatch':
      return `This wallet manages ${rootName} but does not hold the agent token. Move the token here, then try again.`
    case 'token-owner-lookup-failed':
      return `The agent token owner could not be confirmed.${extra}`
    case 'lookup-failed':
      return `The ENS lookup failed.${extra}`
  }
}

type SubdomainEntryProps = {
  parent: string
  pointsTo: Address
  initialValue?: string
  error?: string
  onConfirm: (label: string) => void
  onBack: () => void
}

export const SubdomainEntry: React.FC<SubdomainEntryProps> = ({ parent, pointsTo, initialValue, error, onConfirm, onBack }) => {
  const [draft, setDraft] = React.useState(initialValue ?? '')
  const label = sanitizeSubdomainPrefix(draft.trim())
  return (
    <Surface
      title="Name Your Subdomain"
      subtitle={`Choose the part that comes before .${parent}.`}
      footer={footerHint('↵ continue · esc back')}
    >
      {error ? <Box marginBottom={1}><Paragraph color={theme.accentError}>{error}</Paragraph></Box> : null}
      <TextInput
        key={`ens-subdomain-${parent}`}
        initialValue={initialValue ?? ''}
        placeholder="subdomain"
        onChange={setDraft}
        validate={value => {
          const trimmed = value.trim()
          const next = sanitizeSubdomainPrefix(trimmed)
          if (!next) return 'Enter a subdomain.'
          if (trimmed.includes('.')) return `Enter only the part before .${parent}.`
          if (next !== trimmed.toLowerCase()) return 'Use lowercase letters, numbers, and hyphens.'
          return null
        }}
        onSubmit={value => {
          const next = sanitizeSubdomainPrefix(value.trim())
          if (next) onConfirm(next)
        }}
        onCancel={onBack}
      />
      <Box marginTop={1}>
        <FieldList fields={[
          { label: 'Full name', value: `${label || 'subdomain'}.${parent}`, valueColor: label ? theme.accentPeriwinkle : theme.dim },
          { label: 'Points to', value: shortAddress(pointsTo) },
        ]} />
      </Box>
    </Surface>
  )
}

export const CheckingScreen: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <Surface title={title} subtitle={subtitle} footer={footerHint('esc cancel')}>
    {children}
  </Surface>
)

export const CheckingName: React.FC<{ fullName: string; subtitle?: string; onCancel: () => void }> = ({ fullName, subtitle, onCancel }) => (
  <CheckingScreen title={`Checking ${fullName}`} subtitle={subtitle ?? 'Reading its ENS records on Ethereum Mainnet.'}>
    <Spinner label="Checking the name…" />
    <EscCancel onCancel={onCancel} />
  </CheckingScreen>
)
