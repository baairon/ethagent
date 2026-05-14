import React from 'react'
import { Box, Text } from 'ink'
import { type Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { Spinner } from '../../../ui/Spinner.js'
import { theme } from '../../../ui/theme.js'
import {
  normalizeEthDomain,
  sanitizeSubdomainPrefix,
} from '../../ens/ensLookup.js'
import { isRootEthName } from '../../ens/ensAutomation.js'
import type { Erc8004RegistryConfig } from '../../registry/erc8004.js'
import {
  type CustodyMode,
} from '../custody/state.js'
import { shortAddress } from '../shared/model/format.js'
import {
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
} from './types.js'
import type { AgentReconciliation } from '../shared/reconciliation/index.js'

type AdvancedScreenProps = {
  phase: EnsPhase
  identity: EnsEditProps['identity']
  ownerAddress: Address
  agentId: EnsEditProps['identity']['agentId']
  reconciliation: AgentReconciliation
  savedSubdomainLabel: string
  agentNameSuggestion: string
  currentEnsName: string
  savedCustodyMode: CustodyMode | undefined
  registry: Erc8004RegistryConfig
  setPhase: (phase: EnsPhase) => void
  runDiscovery: (mode?: 'simple' | 'advanced') => void
  runAdvancedSubdomainCheck: (rootName: string, label: string) => void
  onEnsSetup: EnsEditProps['onEnsSetup']
  onEnsLink: EnsEditProps['onEnsLink']
  onWithdrawToken: () => void
}

export function renderAdvancedEnsPhase({
  phase,
  identity,
  ownerAddress,
  agentId,
  reconciliation,
  savedSubdomainLabel,
  agentNameSuggestion,
  currentEnsName,
  savedCustodyMode,
  registry,
  setPhase,
  runDiscovery,
  runAdvancedSubdomainCheck,
  onEnsSetup,
  onEnsLink,
  onWithdrawToken,
}: AdvancedScreenProps): React.ReactNode | null {
  if (phase.kind === 'advanced-transfer-check') {
    type TransferCheckAction = 'continue' | 'withdraw' | 'back'
    const custody = reconciliation.custody
    const tokenInVault = custody === 'advanced' || custody === 'mid-flow-uri-pending'
    const tokenInOwnerWallet = custody === 'simple' || custody === 'withdrawn'
    const probePending = custody === 'unknown' && reconciliation.rpc !== 'failing'
    const probeFailed = reconciliation.rpc === 'failing'

    const options: Array<{ value: TransferCheckAction; role?: 'section' | 'utility'; label: string; hint?: string }> = []
    options.push({ value: 'continue', role: 'section', label: 'Setup' })
    if (tokenInOwnerWallet) {
      options.push({
        value: 'continue',
        label: 'Continue ENS Setup',
        hint: 'Owner wallet holds this token onchain.',
      })
    } else if (tokenInVault) {
      options.push({
        value: 'withdraw',
        label: 'Withdraw Token',
        hint: 'Pull token out to sign ENS records. Redeposit to the Vault any time after.',
      })
    } else if (probePending) {
      options.push({
        value: 'continue',
        label: 'Checking onchain state…',
        hint: 'Try again in a moment.',
      })
    } else if (probeFailed) {
      options.push({
        value: 'continue',
        label: 'Onchain check unavailable',
        hint: 'RPC unreachable. Resolve connectivity, then retry.',
      })
    } else {
      options.push({
        value: 'continue',
        label: 'Token Owner Unknown',
        hint: 'Try again in a moment.',
      })
    }
    options.push({ value: 'back', role: 'section', label: 'Navigation' })
    options.push({ value: 'back', label: 'Back', hint: 'Return to setup type', role: 'utility' })

    return (
      <Surface
        title="Token Custody Check"
        subtitle="ENS setup continues only after the owner wallet holds this token onchain."
        footer={footerHint('enter select · esc back')}
      >
        <Box marginTop={1}>
          <Select<TransferCheckAction>
            options={options}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'withdraw') {
                onWithdrawToken()
                return
              }
              if (choice === 'continue' && tokenInOwnerWallet) {
                runDiscovery('advanced')
                return
              }
              if (choice === 'back') {
                return setPhase({ kind: 'mode-select' })
              }
            }}
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
        subtitle={`Pick a subdomain label under ${rootName}.`}
        footer={footerHint('enter next · esc back')}
      >
        {phase.error ? (
          <Box flexDirection="column">
            <Text color={theme.accentError}>{phase.error}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <TextInput
            key={`advanced-subdomain-${rootName}`}
            initialValue={phase.label || savedSubdomainLabel || ''}
            placeholder={agentNameSuggestion || 'agent-name'}
            validate={value => {
              const trimmed = value.trim()
              const label = sanitizeSubdomainPrefix(trimmed)
              if (!label) return 'Enter a subdomain label'
              if (trimmed.includes('.')) return 'Enter only the subdomain label'
              if (label !== trimmed.toLowerCase()) return 'Use lowercase letters, numbers, and hyphens only'
              return null
            }}
            onSubmit={value => runAdvancedSubdomainCheck(rootName, sanitizeSubdomainPrefix(value))}
            onCancel={() => setPhase({ kind: 'pick-parent', mode: 'advanced' })}
          />
        </Box>
      </Surface>
    )
  }

  if (phase.kind === 'advanced-subdomain-check') {
    return (
      <Surface
        title="Check Agent Subdomain"
        subtitle={`Verifying ${phase.label}.${phase.rootName} on Ethereum Mainnet.`}
        footer={footerHint('esc back')}
      >
        <Box marginTop={1}>
          <Spinner label="checking agent subdomain..." />
        </Box>
        <EscCancel onCancel={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.rootName, label: phase.label })} />
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
          })
        }}
        onBack={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.setup.rootName, label: phase.setup.label })}
      />
    )
  }

  if (phase.kind === 'advanced-manual') {
    return (
      <EnsSetupBlockedScreen
        fallback={phase.fallback}
        onCheckAgain={() => runAdvancedSubdomainCheck(phase.fallback.rootName, phase.fallback.label)}
        onBack={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.fallback.rootName, label: phase.fallback.label })}
      />
    )
  }

  return null
}
