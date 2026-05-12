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
import { FlowTimeline } from '../shared/components/FlowTimeline.js'
import { OPEN_BROWSER_HINT } from '../shared/components/WalletApprovalScreen.js'

const TRANSFER_STEPS = ['Choose Receiver', 'Sender Signs', 'Receiver Signs', 'Sender Updates URI', 'Transfer Token']
const APPROVAL_GUARDRAIL = 'No approve(), setApprovalForAll(), transferFrom(), or token approval is requested.'

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
      subtitle={<FlowTimeline steps={TRANSFER_STEPS} current={1} />}
      footer={<Text color={theme.dim}>Enter Next · Esc Back</Text>}
    >
      <Box flexDirection="column">
        <StatusRow label="Token" value={tokenValue} />
        <StatusRow label="Network" value={tokenNetworkLabel} />
        <StatusRow label="Sender" value={senderValue} />
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.textSubtle}>Use this before any ERC-8004 token transfer.</Text>
          <Text color={theme.textSubtle}>Both signed wallets can read this snapshot; after transfer, restore with the receiver wallet.</Text>
          <Text color={theme.textSubtle}>{APPROVAL_GUARDRAIL}</Text>
          {custodyMode === 'advanced' ? (
            <Text color={theme.textSubtle}>Advanced custody: connect the owner wallet ({senderValue}) to sign as sender.</Text>
          ) : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <TextInput
            label="Receiver Wallet"
            initialValue={initialValue ?? ''}
            placeholder="ENS name or 0x address"
            validate={value => validateTargetInput(value)}
            onSubmit={onSubmit}
            onCancel={onBack}
          />
        </Box>
        {error ? <Box marginTop={1}><Text color={theme.accentError}>{error}</Text></Box> : null}
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
  useAppInput((_input, key) => {
    if (key.escape) onCancel()
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
    label: 'preparing transfer snapshot...',
  }
  const phase = resolvedProgress.phase
  const spinnerLabel = tokenTransferSpinnerLabel(resolvedProgress)
  const activeRoleLabel = resolvedProgress.walletRole === 'receiver' ? 'Receiver' : 'Sender'
  const otherWallet = resolvedProgress.walletRole === 'sender'
    ? { label: 'Receiver', value: `${shortAddress(targetAddress)}${targetHandle !== targetAddress ? ` (${targetHandle})` : ''}` }
    : { label: 'Sender', value: shortAddress(senderAddress) }
  return (
    <Surface
      title="Prepare Token Transfer"
      subtitle={<FlowTimeline steps={TRANSFER_STEPS} current={transferTimelineStep(phase)} />}
      footer={<Text color={theme.dim}>Esc Back</Text>}
    >
      <Box flexDirection="column">
        <StatusRow label="Token" value={identity.agentId ? `#${identity.agentId}` : 'not created'} />
        <StatusRow label="Network" value={tokenNetworkLabel} />
        <StatusRow label="Sender" value={shortAddress(senderAddress)} />
        <StatusRow label="Receiver" value={`${shortAddress(targetAddress)}${targetHandle !== targetAddress ? ` (${targetHandle})` : ''}`} />
        <Box marginTop={1} flexDirection="column">
          <Text color={resolvedProgress.walletRole === 'none' ? theme.text : theme.accentPeriwinkle} bold={resolvedProgress.walletRole !== 'none'}>
            {resolvedProgress.title}
          </Text>
          <Text color={theme.textSubtle}>{resolvedProgress.detail}</Text>
          {resolvedProgress.expectedAddress ? (
            <>
              <StatusRow label={activeRoleLabel} value={shortAddress(resolvedProgress.expectedAddress)} emphasize />
              <StatusRow label={otherWallet.label} value={otherWallet.value} />
            </>
          ) : null}
        </Box>
        {walletSession ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.accentPeriwinkle} underline>{walletSession.url}</Text>
            <Text color={theme.dim}>{OPEN_BROWSER_HINT}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Spinner label={spinnerLabel} />
        </Box>
      </Box>
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
    subtitle={<FlowTimeline steps={TRANSFER_STEPS} current={5} />}
    footer={footer}
  >
    <Box flexDirection="column">
      <Text color={theme.text}>Snapshot published. Transfer the ERC-8004 token externally on {tokenNetworkLabel} from sender to receiver.</Text>
      <Box marginTop={1} flexDirection="column">
        <StatusRow label="Token" value={identity.agentId ? `#${identity.agentId}` : 'not created'} tone={identity.agentId ? 'ok' : 'warn'} />
        <StatusRow label="Network" value={tokenNetworkLabel} tone="ok" />
        <StatusRow label="Sender" value={shortAddress(identity.ownerAddress ?? identity.address)} tone="ok" />
        <StatusRow label="Receiver" value={`${shortAddress(targetAddress)}${targetHandle !== targetAddress ? ` (${targetHandle})` : ''}`} tone="ok" />
        <StatusRow label="Snapshot" value={shortCid(snapshotCid)} tone="ok" />
        <StatusRow label="Token URI tx" value={shortHash(txHash)} tone="ok" />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.textSubtle}>Use this process for every ERC-8004 token transfer.</Text>
        <Text color={theme.textSubtle}>Both sender and receiver signatures can decrypt this snapshot.</Text>
        <Text color={theme.textSubtle}>After transfer, use Load Agent with the receiver wallet.</Text>
        <Text color={theme.textSubtle}>{APPROVAL_GUARDRAIL}</Text>
      </Box>
      <Box marginTop={1}>
        <Select<'back'>
          options={[
            { value: 'back', role: 'section', label: 'Navigation' },
            { value: 'back', label: 'Back', hint: backHint, role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={onBack}
          onCancel={onBack}
        />
      </Box>
    </Box>
  </Surface>
)

type StatusRowProps = { label: string; value: string; tone?: 'ok' | 'warn'; emphasize?: boolean }
const StatusRow: React.FC<StatusRowProps> = ({ label, value, tone, emphasize }) => {
  const color = emphasize ? theme.accentPeriwinkle : tone === 'ok' ? theme.text : tone === 'warn' ? theme.accentPeriwinkle : theme.text
  return (
    <Text>
      <Text color={theme.textSubtle}>{label.padEnd(12)} </Text>
      <Text color={color} bold={emphasize}>{value}</Text>
    </Text>
  )
}

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
  if (!trimmed) return 'Enter the receiver wallet ENS name or 0x address'
  if (trimmed.startsWith('0x') && !/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return 'Enter a valid 0x address'
  if (!trimmed.startsWith('0x') && !trimmed.includes('.')) return 'Enter an ENS name or 0x address'
  return null
}

function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : hash
}

function tokenTransferSpinnerLabel(progress: TokenTransferProgress): string {
  const label = progress.walletRole === 'none'
    ? progress.title
    : progress.walletAction ?? progress.title
  return `${label.replace(/[.]+$/g, '')}...`
}
