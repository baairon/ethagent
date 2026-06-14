import React from 'react'
import { Box, Text } from 'ink'
import type { Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { TextInput } from '../../../ui/TextInput.js'
import { theme } from '../../../ui/theme.js'
import {
  isEthDomain,
  sanitizeSubdomainPrefix,
} from '../../ens/ensLookup.js'
import {
  displayCustodyMode,
  readIdentityStateString,
  type CustodyMode,
} from '../custody/state.js'
import { ensValidationReasonText } from './state.js'
import { shortAddress } from '../shared/model/format.js'
import { readValidationFromState } from './editCopy.js'
import type { EnsEditProps } from './types.js'

export const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

import { abbreviateHexBlobs } from './editCopy.js'

export const renderRecordValue = (value: string) =>
  value
    ? <Text color={theme.accentPeriwinkle}>{abbreviateHexBlobs(value)}</Text>
    : <Text color={theme.dim}>Unset</Text>

export function rootErrorMessage(
  reason: 'invalid-root' | 'missing-token-id' | 'root-not-owned' | 'wrapped-parent' | 'root-owner-mismatch' | 'token-owner-mismatch' | 'token-owner-lookup-failed' | 'lookup-failed',
  detail: string,
  rootName: string,
): string {
  switch (reason) {
    case 'invalid-root':
      return 'Enter the parent .eth name, e.g. name.eth'
    case 'missing-token-id':
      return 'This identity is missing an ERC-8004 token id'
    case 'root-not-owned':
      return `${rootName} does not have an ENS manager on Ethereum mainnet. Switch wallets or pick a different parent name.`
    case 'wrapped-parent':
      return `${rootName} ENS NameWrapper ownership could not be verified: ${detail}`
    case 'root-owner-mismatch':
      return `Connected wallet does not manage ${rootName}. ${detail}`
    case 'token-owner-mismatch':
      return `Connected wallet manages ${rootName} but does not own this ERC-8004 token. ${detail}. Move the token to this wallet, then submit again.`
    case 'token-owner-lookup-failed':
      return `Could not verify ERC-8004 token owner: ${detail}`
    case 'lookup-failed':
      return `ENS lookup failed: ${detail}`
  }
}

export const EnsSetupRow: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <Box flexDirection="row">
    <Box width={16}>
      <Text color={theme.dim}>{label}</Text>
    </Box>
    <Box flexShrink={1}>
      <Text color={muted ? theme.dim : theme.text}>{value}</Text>
    </Box>
  </Box>
)

export const EnsStatusBanner: React.FC<{ identity: EnsEditProps['identity']; noRootEnsName?: boolean }> = ({ identity, noRootEnsName }) => {
  const ensName = readIdentityStateString(identity.state, 'ensName')
  if (!ensName) {
    const status = noRootEnsName
      ? 'Not Linked. This wallet does not own a root .eth ENS name.'
      : 'Not Linked. Choose a setup below.'
    return <Text color={theme.dim}>Status: <Text color={theme.dim}>{status}</Text></Text>
  }
  const validation = readValidationFromState(identity.state)
  if (validation?.ok) {
    return <Text color={theme.dim}>Status: <Text color={theme.accentPeriwinkle}>linked, {ensName}</Text></Text>
  }
  return (
    <Text color={theme.dim}>
      Status: <Text color={theme.accentError}>issue, {ensName}</Text>
      <Text color={theme.dim}> ({ensValidationReasonText(validation?.reason)})</Text>
    </Text>
  )
}

type AssignEnsCurrentSetupProps = {
  currentEnsName: string
  currentMode: CustodyMode | undefined
  ownerAddress: string
  operatorAddress: string
  tokenNetworkLabel: string
}

export const AssignEnsCurrentSetup: React.FC<AssignEnsCurrentSetupProps> = ({
  currentEnsName,
  currentMode,
  ownerAddress,
  operatorAddress,
  tokenNetworkLabel,
}) => {
  const modeLabel = displayCustodyMode(currentMode)
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={theme.dim}>Current Setup</Text>
      <EnsSetupRow label="ENS name" value={currentEnsName || 'None'} muted={!currentEnsName} />
      <EnsSetupRow label="Custody" value={modeLabel} />
      <EnsSetupRow label="ENS network" value="Ethereum Mainnet" />
      <EnsSetupRow label="Token network" value={tokenNetworkLabel} />
      {currentMode === 'advanced'
        ? (
          <>
            {ownerAddress ? <EnsSetupRow label="Owner wallet" value={shortAddress(ownerAddress)} /> : null}
            {operatorAddress ? <EnsSetupRow label="Operator wallet" value={shortAddress(operatorAddress)} /> : null}
          </>
          )
        : null}
    </Box>
  )
}

type SubdomainEntryProps = {
  parent: string
  ownerAddress: Address
  initialValue?: string
  placeholder?: string
  error?: string
  onConfirm: (fullName: string) => void
  onBack: () => void
}

export const SubdomainEntry: React.FC<SubdomainEntryProps> = ({ parent, ownerAddress, initialValue, placeholder, error, onConfirm, onBack }) => (
  <Surface
    title={`Subdomain of ${parent}`}
    footer={footerHint('↵ continues · esc back')}
  >
    {error ? <Text color={theme.accentError}>{error}</Text> : null}
    <TextInput
      key={`edit-ens-subdomain-${parent}`}
      initialValue={initialValue ?? ''}
      placeholder={placeholder || 'subdomain name'}
      validate={value => {
        const v = sanitizeSubdomainPrefix(value)
        if (!v) return 'Subdomain name cannot be empty'
        if (value.includes('.')) return 'Enter only the subdomain name, not the full ENS name'
        if (!isEthDomain(`${v}.${parent}`)) return 'Invalid characters in subdomain name'
        return null
      }}
      onSubmit={value => {
        const prefix = sanitizeSubdomainPrefix(value)
        if (!prefix) return
        onConfirm(`${prefix}.${parent}`)
      }}
      onCancel={onBack}
    />
    <Box marginTop={1}>
      <Text color={theme.dim}>Wallet: {shortAddress(ownerAddress)}</Text>
    </Box>
  </Surface>
)
