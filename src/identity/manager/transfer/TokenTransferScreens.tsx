import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Spinner } from '../../../ui/Spinner.js'
import { TextInput } from '../../../ui/TextInput.js'
import { theme } from '../../../ui/theme.js'
import { useAppInput } from '../../../app/input/AppInputProvider.js'
import { openExternalUrl } from '../../../utils/openExternal.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import type { TokenTransferProgress } from '../shared/effects/types.js'
import { readCustodyMode } from '../custody/state.js'
import { shortAddress, shortCid } from '../shared/model/format.js'
import { StepHeader } from '../shared/components/StepHeader.js'
import { FieldList } from '../shared/components/FieldRow.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { OPEN_BROWSER_HINT } from '../shared/components/WalletApprovalScreen.js'

const TRANSFER_STEPS = ['Choose Receiver', 'Sender Signs', 'Receiver Signs', 'Sender Updates URI', 'Transfer Token']

type TokenTransferTargetScreenProps = {
  identity: EthagentIdentity
  tokenNetworkLabel: string
  error?: string
  initialValue?: string
  onSubmit: (value: string) => void
  onBack: () => void
}

export const TokenTransferTargetScreen: React.FC<TokenTransferTargetScreenProps> = ({
  identity,
  tokenNetworkLabel,
  error,
  initialValue,
  onSubmit,
  onBack,
}) => {
  const tokenValue = identity.agentId ? `#${identity.agentId}` : 'not created'
  const senderValue = shortAddress(identity.ownerAddress ?? identity.address)
  const custodyMode = readCustodyMode(identity.state)
  return (
    <Surface
      title="Prepare Token Transfer"
      subtitle={<StepHeader steps={TRANSFER_STEPS} current={1} description="Both wallets sign a handoff snapshot, then you send the token yourself." />}
      footer={<Text color={theme.dim}>↵ continue · esc back</Text>}
    >
      <FieldList fields={[
        { label: 'Token', value: `${tokenValue} on ${tokenNetworkLabel}` },
        { label: 'Sender', value: custodyMode === 'advanced' ? `${senderValue} (owner wallet signs)` : senderValue },
      ]} />
      <Box marginTop={1}><Text color={theme.dim}>No token approval is requested.</Text></Box>
      {error ? <Box marginTop={1}><Paragraph color={theme.accentError}>{error}</Paragraph></Box> : null}
      <Box marginTop={1}>
        <TextInput
          label="Receiver wallet"
          initialValue={initialValue ?? ''}
          placeholder="ENS name or 0x address"
          validate={value => validateTargetInput(value)}
          onSubmit={onSubmit}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type TokenTransferSigningScreenProps = {
  identity: EthagentIdentity
  tokenNetworkLabel: string
  targetHandle: string
  targetAddress: string
  progress: TokenTransferProgress | null
  walletSession: BrowserWalletReady | null
  onCancel: () => void
}

export const TokenTransferSigningScreen: React.FC<TokenTransferSigningScreenProps> = ({
  identity,
  tokenNetworkLabel,
  targetHandle,
  targetAddress,
  progress,
  walletSession,
  onCancel,
}) => {
  useAppInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) onCancel()
    if (key.return && walletSession?.url) {
      openExternalUrl(walletSession.url)
    }
  }, { isActive: true })

  const senderAddress = identity.ownerAddress ?? identity.address
  const resolvedProgress = progress ?? {
    phase: 'sender-sign' as const,
    walletRole: 'sender' as const,
    expectedAddress: senderAddress as TokenTransferProgress['expectedAddress'],
    title: 'Use Sender Wallet',
    detail: 'Sign to save a transfer snapshot.',
    walletAction: 'Sign Snapshot',
    label: 'preparing transfer snapshot…',
  }
  const phase = resolvedProgress.phase
  const spinnerLabel = tokenTransferSpinnerLabel(resolvedProgress)
  const receiverValue = `${shortAddress(targetAddress)}${targetHandle !== targetAddress ? ` (${targetHandle})` : ''}`
  const signing = resolvedProgress.walletRole
  void tokenNetworkLabel
  return (
    <Surface
      title="Prepare Token Transfer"
      subtitle={<StepHeader steps={TRANSFER_STEPS} current={transferTimelineStep(phase)} />}
      footer={<Text color={theme.dim}>esc back</Text>}
    >
      <Text color={signing === 'none' ? theme.text : theme.accentPeriwinkle} bold={signing !== 'none'}>{resolvedProgress.title}</Text>
      <Paragraph color={theme.textSubtle}>{resolvedProgress.detail}</Paragraph>
      <Box marginTop={1}>
        <FieldList fields={[
          { label: 'Sender', value: `${shortAddress(senderAddress)}${signing === 'sender' ? '  signs now' : ''}`, ...(signing === 'sender' ? { valueColor: theme.accentPeriwinkle } : {}) },
          { label: 'Receiver', value: `${receiverValue}${signing === 'receiver' ? '  signs now' : ''}`, ...(signing === 'receiver' ? { valueColor: theme.accentPeriwinkle } : {}) },
        ]} />
      </Box>
      <Box marginTop={1}>
        <Spinner label={spinnerLabel} />
      </Box>
      {walletSession ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.textSubtle}>{OPEN_BROWSER_HINT}</Text>
          <Text color={theme.accentBlue} underline>{walletSession.url}</Text>
        </Box>
      ) : null}
    </Surface>
  )
}

type TokenTransferReadyScreenProps = {
  identity: EthagentIdentity
  tokenNetworkLabel: string
  targetHandle: string
  targetAddress: string
  snapshotCid: string
  txHash: string
  footer: React.ReactNode
  backHint: string
  onBack: () => void
}

export const TokenTransferReadyScreen: React.FC<TokenTransferReadyScreenProps> = ({
  identity,
  tokenNetworkLabel,
  targetHandle,
  targetAddress,
  snapshotCid,
  txHash,
  footer,
  backHint,
  onBack,
}) => (
  <Surface
    title="Transfer Snapshot Ready"
    subtitle={<StepHeader steps={TRANSFER_STEPS} current={5} description="Now send the token to the receiver from your wallet. They restore the agent with theirs." />}
    footer={footer}
  >
    <FieldList fields={[
      { label: 'Token', value: identity.agentId ? `#${identity.agentId} on ${tokenNetworkLabel}` : 'Not created' },
      { label: 'Sender', value: shortAddress(identity.ownerAddress ?? identity.address) },
      { label: 'Receiver', value: `${shortAddress(targetAddress)}${targetHandle !== targetAddress ? ` (${targetHandle})` : ''}` },
      { label: 'Snapshot', value: shortCid(snapshotCid) },
      { label: 'URI update', value: shortHash(txHash) },
    ]} />
    <Box marginTop={1}><Text color={theme.dim}>No token approval is requested.</Text></Box>
    <Box marginTop={1}>
      <Select<'back'>
        options={[
          { value: 'back', label: 'Back', hint: backHint, role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={onBack}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)

function transferTimelineStep(phase: TokenTransferProgress['phase'] | undefined): number {
  switch (phase) {
    case 'sender-sign':
      return 2
    case 'target-sign':
      return 3
    case 'pinning':
    case 'sender-transaction':
    case 'confirming':
      return 4
    default:
      return 2
  }
}

function validateTargetInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter the receiver\'s ENS name or 0x address.'
  if (trimmed.startsWith('0x') && !/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return 'That is not a valid 0x address.'
  if (!trimmed.startsWith('0x') && !trimmed.includes('.')) return 'Enter an ENS name or 0x address.'
  return null
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash
}

function tokenTransferSpinnerLabel(progress: TokenTransferProgress): string {
  const label = progress.walletRole === 'none'
    ? progress.title
    : progress.walletAction ?? progress.title
  return `${label.replace(/[.…]+$/g, '')}…`
}
