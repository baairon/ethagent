import React from 'react'
import { Box, Text } from 'ink'
import { getAddress, isAddress, type Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../ui/Select.js'
import { Spinner } from '../../../ui/Spinner.js'
import { theme } from '../../../ui/theme.js'
import { useAppInput } from '../../../app/input/AppInputProvider.js'
import { openExternalUrl } from '../../../utils/openExternal.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import type { Erc8004RegistryConfig } from '../../registry/erc8004.js'
import {
  createWalletRestoreAccessChallenge,
  createWalletRestoreAccessKey,
} from '../../continuity/envelope.js'
import { requestBrowserWalletSignature, type BrowserWalletReady } from '../../wallet/browserWallet.js'
import { FlowTimeline } from '../shared/components/FlowTimeline.js'
import { OPEN_BROWSER_HINT } from '../shared/components/WalletApprovalScreen.js'
import { readCustodyMode } from '../custody/state.js'
import { shortAddress } from '../shared/model/format.js'
import type { ProfileUpdates } from '../reducer.js'
import {
  normalizeApprovedOperatorWallets,
  removeApprovedOperatorWallet,
  upsertApprovedOperatorWallet,
  type ApprovedOperatorWalletRecord,
} from '../shared/operatorWallets.js'

type OperatorPhase =
  | { kind: 'main'; notice?: string; error?: string }
  | { kind: 'signing' }

type OperatorAction =
  | 'add-browser'
  | 'back'
  | 'remove-all'
  | `remove:${string}`
  | `activate:${string}`

type OperatorWalletsScreenProps = {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  walletSession: BrowserWalletReady | null
  notice?: string
  error?: string
  onSave: (updates: ProfileUpdates) => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onBack: () => void
}

export const OperatorWalletsScreen: React.FC<OperatorWalletsScreenProps> = ({
  identity,
  registry,
  walletSession,
  notice,
  error,
  onSave,
  onWalletReady,
  onBack,
}) => {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const custodyMode = readCustodyMode(state)
  const ownerAddressRaw = readOwnerAddressField(state)
  const ownerAddress = ownerAddressRaw && isAddress(ownerAddressRaw, { strict: false }) ? getAddress(ownerAddressRaw) : undefined
  const activeOperatorAddress = readStateAddress(state, 'activeOperatorAddress')
  const restoreAccessEpoch = readStateNumber(state, 'restoreAccessEpoch') ?? 0
  const records = normalizeApprovedOperatorWallets(state.approvedOperatorWallets)
  const [phase, setPhase] = React.useState<OperatorPhase>({ kind: 'main', notice, error })

  React.useEffect(() => {
    setPhase(current => current.kind === 'main' ? { kind: 'main', notice, error } : current)
  }, [notice, error])

  const saveOperators = React.useCallback((
    approvedOperatorWallets: ApprovedOperatorWalletRecord[],
    activeOperator: Address | '' | undefined,
  ) => {
    const updates: ProfileUpdates = {
      custodyMode: 'advanced',
      ...(ownerAddress ? { ownerAddress } : {}),
      approvedOperatorWallets,
      restoreAccessEpoch: restoreAccessEpoch + 1,
    }
    if (activeOperator !== undefined) updates.activeOperatorAddress = activeOperator
    onSave(updates)
  }, [ownerAddress, onSave, restoreAccessEpoch])

  const addRecord = React.useCallback((record: ApprovedOperatorWalletRecord) => {
    if (!ownerAddress) {
      setPhase({ kind: 'main', error: 'advanced custody needs an owner wallet before managing operator wallets' })
      return
    }
    if (record.address.toLowerCase() === ownerAddress.toLowerCase()) {
      setPhase({ kind: 'main', error: 'operator wallet must differ from the owner wallet' })
      return
    }
    const next = upsertApprovedOperatorWallet(records, record)
    const active = activeOperatorAddress ?? record.address
    saveOperators(next, active)
  }, [activeOperatorAddress, ownerAddress, records, saveOperators])

  const startBrowserSignature = React.useCallback(() => {
    if (!ownerAddress) {
      setPhase({ kind: 'main', error: 'advanced custody needs an owner wallet before managing operator wallets' })
      return
    }
    if (!identity.agentId) {
      setPhase({ kind: 'main', error: 'agent token ID is required before authorizing a wallet' })
      return
    }
    const token = restoreAccessToken(registry, identity.agentId)
    const nextEpoch = restoreAccessEpoch + 1
    setPhase({ kind: 'signing' })
    requestBrowserWalletSignature({
      chainId: registry.chainId,
      purpose: 'operator-proof',
      messageForAccount: account => createWalletRestoreAccessChallenge({
        token,
        ownerAddress: ownerAddress,
        walletAddress: account,
        accessEpoch: nextEpoch,
        purpose: 'restore-operator',
      }),
      onReady: onWalletReady,
    }).then(wallet => {
      onWalletReady(null)
      const restoreAccessKey = createWalletRestoreAccessKey({
        token,
        ownerAddress: ownerAddress,
        walletAddress: wallet.account,
        walletSignature: wallet.signature,
        accessEpoch: nextEpoch,
        createdAt: new Date().toISOString(),
        purpose: 'restore-operator',
      })
      addRecord({
        address: wallet.account,
        challenge: wallet.message,
        verifiedAt: restoreAccessKey.createdAt,
        restoreAccessKey,
      })
    }).catch((err: unknown) => {
      onWalletReady(null)
      setPhase({ kind: 'main', error: err instanceof Error ? err.message : String(err) })
    })
  }, [addRecord, ownerAddress, identity.agentId, onWalletReady, registry, restoreAccessEpoch])

  if (custodyMode !== 'advanced' || !ownerAddress) {
    return (
      <Surface
        title="Operator Wallets"
        subtitle="Set up Advanced custody first."
        footer={footerHint('↵ select · esc back')}
      >
        <Box flexDirection="column">
          {phase.kind === 'main' && phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <Select<'back'>
            options={[
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={() => onBack()}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'signing') {
    return (
      <WalletWaitSurface
        title="Authorize Wallet"
        subtitle={
          <Box flexDirection="column">
            <FlowTimeline steps={['Verify Operator', 'Sign Backup', 'Publish Snapshot', 'Approve ENS', 'Approve Vault']} current={1} />
          </Box>
        }
        walletSession={walletSession}
        onCancel={() => {
          onWalletReady(null)
          setPhase({ kind: 'main' })
        }}
      />
    )
  }

  const options = operatorOptions({
    records,
    activeOperatorAddress,
  })
  const phaseNotice = phase.kind === 'main' ? phase.notice : undefined
  const phaseError = phase.kind === 'main' ? phase.error : undefined

  return (
    <Surface
      title="Operator Wallets"
      subtitle="Owner wallet controls this list."
      footer={footerHint('↵ select · esc back')}
    >
      <Box flexDirection="column">
        <Text>
          <Text color={theme.dim}>{'Owner Wallet'.padEnd(18)}</Text>
          <Text color={theme.text}>{shortAddress(ownerAddress)}</Text>
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>Operator Wallets</Text>
          {records.length > 0
            ? records.map(record => {
                const isActive = record.address.toLowerCase() === activeOperatorAddress?.toLowerCase()
                const approved = record.verifiedAt ? `approved ${record.verifiedAt.slice(0, 10)}` : null
                const meta = [isActive ? 'active' : null, approved].filter(Boolean).join(' · ')
                return (
                  <Text key={record.address}>
                    <Text color={isActive ? theme.accentPeriwinkle : theme.text}>
                      {shortAddress(record.address)}
                    </Text>
                    {meta ? <Text color={theme.dim}>{`  ${meta}`}</Text> : null}
                  </Text>
                )
              })
            : <Text color={theme.dim}>No operator wallets saved.</Text>}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.dim}>Add as many operator wallets as needed; unlink any saved wallet here.</Text>
          <Text color={theme.dim}>No approve(), setApprovalForAll(), transferFrom(), or token approval is requested.</Text>
        </Box>
        {phaseNotice ? <Text color={theme.accentPeriwinkle}>{phaseNotice}</Text> : null}
        {phaseError ? <Text color={theme.accentError}>{phaseError}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Select<OperatorAction>
          options={options}
          hintLayout="inline"
          maxVisible={10}
          onSubmit={choice => {
            if (choice === 'add-browser') return startBrowserSignature()
            if (choice === 'back') return onBack()
            if (choice === 'remove-all') {
              try {
                saveOperators([], '')
              } catch (err: unknown) {
                setPhase({ kind: 'main', error: err instanceof Error ? err.message : String(err) })
              }
              return
            }
            if (choice.startsWith('remove:')) {
              try {
                const address = getAddress(choice.slice('remove:'.length))
                const next = removeApprovedOperatorWallet(records, address)
                const removedActive = activeOperatorAddress?.toLowerCase() === address.toLowerCase()
                const nextActive = removedActive ? '' : activeOperatorAddress ?? ''
                saveOperators(next, nextActive)
              } catch (err: unknown) {
                setPhase({ kind: 'main', error: err instanceof Error ? err.message : String(err) })
              }
            }
            if (choice.startsWith('activate:')) {
              try {
                const address = getAddress(choice.slice('activate:'.length))
                saveOperators(records, address)
              } catch (err: unknown) {
                setPhase({ kind: 'main', error: err instanceof Error ? err.message : String(err) })
              }
            }
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

function operatorOptions(args: {
  records: ApprovedOperatorWalletRecord[]
  activeOperatorAddress: Address | undefined
}): Array<SelectOption<OperatorAction>> {
  const options: Array<SelectOption<OperatorAction>> = [
    { value: 'add-browser', role: 'section', label: 'Operator Wallets' },
    { value: 'add-browser', label: 'Add Wallet' },
  ]
  if (args.records[0]) options.push({ value: `remove:${args.records[0].address}`, role: 'section', label: 'Operator Wallets' })
  for (const record of args.records) {
    const active = args.activeOperatorAddress?.toLowerCase() === record.address.toLowerCase()
    if (!active) {
      options.push({
        value: `activate:${record.address}`,
        label: `Set Active: ${shortAddress(record.address)}`,
      })
    }
    options.push({
      value: `remove:${record.address}`,
      label: `Unlink ${shortAddress(record.address)}${active ? ' (active)' : ''}`,
      ...(active ? {} : { hint: 'Remove' }),
    })
  }
  if (args.records.length > 1) {
    options.push({
      value: 'remove-all',
      label: 'Unlink All Operator Wallets',
    })
  }
  options.push(
    { value: 'back', role: 'section', label: 'Navigation' },
    { value: 'back', label: 'Back', role: 'utility' },
  )
  return options
}

const WalletWaitSurface: React.FC<{
  title: string
  subtitle: React.ReactNode
  walletSession: BrowserWalletReady | null
  onCancel: () => void
}> = ({ title, subtitle, walletSession, onCancel }) => {
  useAppInput((_input, key) => {
    if (key.escape) onCancel()
    if (key.return && walletSession?.url) {
      openExternalUrl(walletSession.url)
    }
  })
  return (
    <Surface title={title} subtitle={subtitle} footer={footerHint('esc cancels')}>
      {walletSession ? (
        <Box flexDirection="column">
          <Text color={theme.accentBlue} underline>{walletSession.url}</Text>
          <Text color={theme.dim}>{OPEN_BROWSER_HINT}</Text>
          <Box marginTop={1}>
            <Spinner label="waiting for operator wallet signature..." />
          </Box>
        </Box>
      ) : (
        <Spinner label="opening wallet request..." />
      )}
    </Surface>
  )
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

function readStateNumber(state: Record<string, unknown>, key: string): number | undefined {
  const value = state[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function restoreAccessToken(registry: Erc8004RegistryConfig, agentId: string) {
  return {
    chainId: registry.chainId,
    identityRegistryAddress: registry.identityRegistryAddress,
    agentId,
  }
}

function readStateAddress(state: Record<string, unknown>, key: string): Address | undefined {
  const value = state[key]
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) return undefined
  return getAddress(value)
}
