import React from 'react'
import { Box, Text } from 'ink'
import { getAddress, type Address } from 'viem'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { Spinner } from '../../../../ui/Spinner.js'
import { theme } from '../../../../ui/theme.js'
import {
  normalizeEthDomain,
  sanitizeSubdomainPrefix,
} from '../../../ens/ensLookup.js'
import { isRootEthName } from '../../../ens/ensAutomation.js'
import type { Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'
import {
  type CustodyMode,
} from '../../model/custody.js'
import { shortAddress } from '../../model/format.js'
import { WalletApprovalScreen } from '../../components/WalletApprovalScreen.js'
import { advancedSubdomainStatusText } from './ensEditCopy.js'
import {
  EnsSetupRow,
  footerHint,
} from './EnsEditShared.js'
import {
  EnsSetupBlockedScreen,
  EnsSetupReviewScreen,
} from './EnsEditReviewScreens.js'
import { EscCancel } from './EnsEditRunners.js'
import type {
  EnsEditProps,
  EnsPhase,
} from './ensEditTypes.js'

type AdvancedScreenProps = {
  phase: EnsPhase
  ownerAddress: Address
  agentId: EnsEditProps['identity']['agentId']
  savedOwnerAddress: string
  savedOperator: string
  savedRootName: string
  savedSubdomainLabel: string
  agentNameSuggestion: string
  currentEnsName: string
  savedCustodyMode: CustodyMode | undefined
  registry: Erc8004RegistryConfig
  operatorWalletSession: BrowserWalletReady | null
  setPhase: (phase: EnsPhase) => void
  connectOperatorWallet: (rootName: string, label: string) => void
  runAdvancedRootCheck: (rootName: string) => void
  runAdvancedSubdomainCheck: (rootName: string, label: string) => void
  runAdvancedPreflight: (rootName: string, label: string, operatorWallet: Address) => void
  onEnsSetup: EnsEditProps['onEnsSetup']
  onEnsLink: EnsEditProps['onEnsLink']
}

export function renderAdvancedEnsPhase({
  phase,
  ownerAddress,
  agentId,
  savedOwnerAddress,
  savedOperator,
  savedRootName,
  savedSubdomainLabel,
  agentNameSuggestion,
  currentEnsName,
  savedCustodyMode,
  registry,
  operatorWalletSession,
  setPhase,
  connectOperatorWallet,
  runAdvancedRootCheck,
  runAdvancedSubdomainCheck,
  runAdvancedPreflight,
  onEnsSetup,
  onEnsLink,
}: AdvancedScreenProps): React.ReactNode | null {
  if (phase.kind === 'advanced-transfer-check') {
    type TransferCheckAction = 'skip' | 'back'
    return (
      <Surface
        title="Token Custody Check"
        subtitle="ENS setup continues only after the owner wallet holds this token."
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Current token owner: <Text color={theme.text}>{shortAddress(ownerAddress)}</Text></Text>
          <Box marginTop={1} flexDirection="column">
            <EnsSetupRow label="Owner wallet" value={`Holds ERC-8004 token #${agentId ?? 'unknown'} and signs ENS records.`} />
            <EnsSetupRow label="Operator wallet" value="Restores snapshots; never controls the token." />
            <EnsSetupRow label="Token moves" value="If the token is in the Vault, withdraw it first from Custody Mode." />
          </Box>
        </Box>
        <Box marginTop={1}>
          <Select<TransferCheckAction>
            options={[
              { value: 'skip', role: 'section', label: 'Setup' },
              { value: 'skip', label: 'Continue ENS Setup', hint: 'The connected wallet is already the owner wallet' },
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back', hint: 'Return to setup type', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'skip') return setPhase({ kind: 'advanced-root', rootName: savedRootName })
              return setPhase({ kind: 'mode-select' })
            }}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-root') {
    return (
      <Surface
        title="Root ENS"
        footer={footerHint('enter next · esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Enter the parent .eth name. The owner wallet must manage it and own this ERC-8004 token.</Text>
          {savedOwnerAddress ? <Text color={theme.dim}>Saved owner wallet: <Text color={theme.text}>{shortAddress(savedOwnerAddress)}</Text></Text> : null}
          {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <TextInput
            key="advanced-root"
            initialValue={phase.rootName || savedRootName}
            placeholder="name.eth"
            validate={value => {
              const root = normalizeEthDomain(value)
              if (!root) return 'Enter a parent .eth name'
              if (!isRootEthName(root)) return 'Enter the parent .eth name, e.g. name.eth'
              return null
            }}
            onSubmit={value => runAdvancedRootCheck(normalizeEthDomain(value))}
            onCancel={() => setPhase({ kind: 'mode-select' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-root-check') {
    return (
      <Surface
        title="Checking ENS and Token Ownership"
        subtitle={`Verifying the connected wallet manages ${phase.rootName} and owns the ERC-8004 token.`}
        footer={footerHint('esc back')}
      >
        <Box marginTop={1}>
          <Text color={theme.textSubtle}>Reading from Ethereum mainnet...</Text>
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-subdomain') {
    const rootName = phase.rootName
    return (
      <Surface
        title="Agent Subdomain"
        footer={footerHint('enter next · esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Create one subdomain for this agent only. Root .eth names stay parent names.</Text>
          <Text color={theme.dim}>Parent: <Text color={theme.text}>{rootName}</Text></Text>
          {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <TextInput
            key={`advanced-subdomain-${rootName}`}
            initialValue={phase.label || savedSubdomainLabel || agentNameSuggestion}
            placeholder="agent-name"
            validate={value => {
              const trimmed = value.trim()
              const label = sanitizeSubdomainPrefix(trimmed)
              if (!label) return 'Enter a subdomain label'
              if (trimmed.includes('.')) return 'Enter only the subdomain label'
              if (label !== trimmed.toLowerCase()) return 'Use lowercase letters, numbers, and hyphens only'
              return null
            }}
            onSubmit={value => runAdvancedSubdomainCheck(rootName, sanitizeSubdomainPrefix(value))}
            onCancel={() => setPhase({ kind: 'advanced-root', rootName })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-subdomain-check') {
    return (
      <Surface
        title="Check Agent Subdomain"
        footer={footerHint('esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Agent ENS: <Text color={theme.text}>{phase.label}.{phase.rootName}</Text></Text>
          <Text color={theme.dim}>Checking whether the subdomain is ready or needs the owner wallet to create it.</Text>
        </Box>
        <Box marginTop={1}>
          <Spinner label="checking agent subdomain..." />
        </Box>
        <EscCancel onCancel={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.rootName, label: phase.label })} />
      </Surface>
    )
  }

  if (phase.kind === 'advanced-operator-wallet') {
    const { rootName, label } = phase
    return (
      <Surface
        title="Operator Wallet"
        footer={footerHint('enter select · esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Agent ENS: <Text color={theme.text}>{label}.{rootName}</Text></Text>
          {phase.registryAction ? <Text color={theme.dim}>{advancedSubdomainStatusText(phase.registryAction)}</Text> : null}
          <Text color={theme.dim}>Choose the operator wallet for snapshot restore access and onchain ERC-8004 URI rotation via the Vault.</Text>
          <Text color={theme.dim}>The operator wallet has no authority over this ENS subdomain or any token transfer; the owner wallet is the sole signer for both.</Text>
          <Text color={theme.dim}>We only read the operator's address here so it can be added to the snapshot envelope and vault operator list later.</Text>
          {savedOperator ? <Text color={theme.dim}>Saved operator wallet: <Text color={theme.text}>{shortAddress(savedOperator)}</Text></Text> : null}
          {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <Select<'connect' | 'enter' | 'back'>
            options={[
              { value: 'connect', role: 'section', label: 'Operator Wallet' },
              { value: 'connect', label: 'Connect Wallet', hint: 'Connect the wallet that will be the operator' },
              { value: 'enter', label: 'Enter Wallet Address', hint: 'Paste the operator wallet address' },
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Back', hint: 'Return to subdomain', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'connect') return connectOperatorWallet(rootName, label)
              if (choice === 'enter') return setPhase({ kind: 'advanced-operator-wallet-manual', rootName, label })
              return setPhase({ kind: 'advanced-subdomain', rootName, label })
            }}
            onCancel={() => setPhase({ kind: 'advanced-subdomain', rootName, label })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-operator-wallet-manual') {
    const { rootName, label } = phase
    return (
      <Surface
        title="Operator Wallet"
        footer={footerHint('enter next · esc back')}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>The operator wallet is saved in ERC-8004 metadata for lookup and restore access.</Text>
          <Text color={theme.dim}>It gets no token approval or transfer right.</Text>
          <Text color={theme.dim}>Owner wallet signs the ENS and ERC-8004 transactions after this address is checked.</Text>
          <Text color={theme.dim}>Any future token move still starts with Prepare Token Transfer.</Text>
          {phase.error ? <Text color={theme.accentError}>{phase.error}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <TextInput
            key="advanced-operator-wallet-manual"
            initialValue={savedOperator}
            placeholder="0x..."
            validate={value => /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? null : 'enter a valid 0x address'}
            onSubmit={value => runAdvancedPreflight(rootName, label, getAddress(value.trim()))}
            onCancel={() => setPhase({ kind: 'advanced-operator-wallet', rootName, label })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-operator-wallet-connecting') {
    return (
      <WalletApprovalScreen
        title="Connect Wallet"
        subtitle="Connect the operator wallet only to read its address for ERC-8004 metadata. It does not sign or submit a transaction."
        walletSession={operatorWalletSession}
        label="waiting for wallet connection..."
        onCancel={() => setPhase({ kind: 'advanced-operator-wallet', rootName: phase.rootName, label: phase.label })}
      />
    )
  }

  if (phase.kind === 'advanced-preflight') {
    return (
      <Surface
        title="Check ENS Setup"
        footer={footerHint('esc back')}
      >
        <Box marginTop={1}>
          <Spinner label="checking ens setup..." />
        </Box>
        <EscCancel onCancel={() => setPhase({ kind: 'advanced-operator-wallet', rootName: phase.rootName, label: phase.label })} />
      </Surface>
    )
  }

  if (phase.kind === 'advanced-review') {
    return (
      <EnsSetupReviewScreen
        setup={phase.setup}
        currentEnsName={currentEnsName}
        currentMode={savedCustodyMode}
        registry={registry}
        onBegin={() => {
          if (phase.setup.txCount > 0) {
            onEnsSetup(phase.setup)
            return
          }
          onEnsLink(phase.setup.fullName, {
            mode: 'advanced',
            ownerAddress: phase.setup.ownerAddress,
            operatorWallet: phase.setup.operatorAddress,
          })
        }}
        onBack={() => setPhase({ kind: 'advanced-operator-wallet', rootName: phase.setup.rootName, label: phase.setup.label })}
      />
    )
  }

  if (phase.kind === 'advanced-manual') {
    return (
      <EnsSetupBlockedScreen
        fallback={phase.fallback}
        onCheckAgain={() => runAdvancedPreflight(phase.fallback.rootName, phase.fallback.label, phase.fallback.operatorAddress)}
        onBack={() => setPhase({ kind: 'advanced-operator-wallet', rootName: phase.fallback.rootName, label: phase.fallback.label })}
      />
    )
  }

  return null
}
