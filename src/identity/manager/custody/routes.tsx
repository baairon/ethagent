import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import { shortAddress } from '../shared/model/format.js'
import type { Step } from '../reducer.js'
import type { CustodyFlowDeps } from './types.js'
import { chainLabel, humanOwnerAddress } from './helpers.js'

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Text>
    <Text color={theme.dim}>{label.padEnd(18)}</Text>
    <Text color={theme.text}>{value}</Text>
  </Text>
)

export function renderCustodyStep({
  step,
  setStep,
  walletSession,
}: CustodyFlowDeps): React.ReactElement | null {
  if (step.kind === 'custody-vault-deploy-tx') {
    return (
      <WalletApprovalScreen
        title="Deploy Vault"
        subtitle={`Deploying Vault on ${chainLabel(step.registry.chainId)}.`}
        walletSession={walletSession}
        label="waiting for wallet to deploy Vault..."
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-deposit-tx') {
    return (
      <WalletApprovalScreen
        title="Deposit Token Into Vault"
        subtitle={`Depositing token #${step.identity.agentId ?? ''} into its Vault.`}
        walletSession={walletSession}
        label="waiting for wallet to deposit token..."
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-withdraw-discovering') {
    const targetAgentId = step.identity.agentId ?? ''
    return (
      <Surface
        title="Checking Vault"
        subtitle={targetAgentId
          ? `Checking Vault on ${chainLabel(step.registry.chainId)}.`
          : `Checking this identity's recorded Vault on ${chainLabel(step.registry.chainId)}.`}
        footer={<Text color={theme.dim}>esc cancel</Text>}
      >
      </Surface>
    )
  }
  if (step.kind === 'custody-vault-withdraw-tx') {
    const targetAgentId = step.agentId ?? step.identity.agentId ?? ''
    return (
      <WalletApprovalScreen
        title="Withdraw Token"
        subtitle={`Withdraws token #${targetAgentId} from its Vault.`}
        walletSession={walletSession}
        label="waiting for wallet to withdraw token..."
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-withdraw-pick-token') {
    const activeId = step.identity.agentId
    const options = step.tokens.map(t => ({
      value: t.agentId,
      label: `Token #${t.agentId}${activeId && t.agentId === activeId ? ' (active)' : ''}`,
      hint: 'Withdraw to owner wallet',
    }))
    return (
      <Surface
        title="Pick a Vaulted Token"
        subtitle={`${step.tokens.length} vaulted tokens on ${chainLabel(step.registry.chainId)}.`}
        footer={<Text color={theme.dim}>enter select · esc back</Text>}
      >
        <Box marginTop={1}>
          <Select<string>
            options={[
              ...options,
              { value: 'cancel', label: 'Back', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'cancel') {
                setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
                return
              }
              setStep({
                kind: 'custody-vault-withdraw-tx',
                identity: step.identity,
                registry: step.registry,
                vaultAddress: step.vaultAddress,
                agentId: choice,
                returnTo: step.returnTo,
                ...(step.returnContext ? { returnContext: step.returnContext } : {}),
              })
            }}
            onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
          />
        </Box>
      </Surface>
    )
  }
  if (step.kind === 'custody-vault-withdraw-done') {
    const onReturnToVault = () => {
      setStep({
        kind: 'custody-vault-deposit-tx',
        identity: step.identity,
        registry: step.registry,
        vaultAddress: step.vaultAddress,
        profileUpdates: { operatorVaultAddress: step.vaultAddress },
        returnTo: step.returnTo,
      })
    }
    const onKeepOut = () => {
      if (step.returnContext === 'ens' && step.returnTo) {
        setStep(step.returnTo)
      } else {
        setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
      }
    }
    return (
      <Surface
        title="Token Returned to Owner Wallet"
        subtitle={`Token returned to ${shortAddress(step.recipient)}.`}
        footer={<Text color={theme.dim}>enter select · esc back</Text>}
      >
        <Box marginTop={1}>
          <Select<'return-to-vault' | 'keep-out'>
            options={[
              { value: 'return-to-vault', label: 'Return Token to Vault', hint: 'Redeposit' },
              { value: 'keep-out', label: 'Keep Out For Now', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'return-to-vault') onReturnToVault()
              else onKeepOut()
            }}
            onCancel={onKeepOut}
          />
        </Box>
      </Surface>
    )
  }
  if (step.kind === 'custody-vault-unwrap-tx') {
    return (
      <WalletApprovalScreen
        title="Unwrap Token From Vault"
        subtitle={`Unwrapping token #${step.identity.agentId ?? ''} from Vault.`}
        walletSession={walletSession}
        label="waiting for wallet to unwrap token..."
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-advanced-done') {
    const state = (step.identity.state ?? {}) as Record<string, unknown>
    const ownerWallet = humanOwnerAddress(step.identity) as string
    const operatorCount = Array.isArray(state.approvedOperatorWallets) ? state.approvedOperatorWallets.length : 0
    return (
      <Surface
        title="Advanced Custody Active"
        subtitle="Token held in its Vault. Operators rotate the URI onchain."
        footer={<Text color={theme.dim}>enter continues</Text>}
      >
        <Box flexDirection="column">
          {step.vaultAddress ? <Row label="Vault" value={shortAddress(step.vaultAddress)} /> : null}
          <Row label="Owner Wallet" value={shortAddress(ownerWallet)} />
          <Row label="Operator Wallets" value={operatorCount === 1 ? '1 approved' : `${operatorCount} approved`} />
        </Box>
        <Box marginTop={1}>
          <Select<'continue'>
            options={[{ value: 'continue', label: 'Done' }]}
            onSubmit={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
            onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
          />
        </Box>
      </Surface>
    )
  }
  if (step.kind === 'custody-simple-done') {
    const ownerWallet = humanOwnerAddress(step.identity) as string
    return (
      <Surface
        title="Simple Custody Active"
        subtitle="Token back in owner wallet."
        footer={<Text color={theme.dim}>enter continues</Text>}
      >
        <Box flexDirection="column">
          <Row label="Owner Wallet" value={shortAddress(ownerWallet)} />
        </Box>
        <Box marginTop={1}>
          <Select<'continue'>
            options={[{ value: 'continue', label: 'Done' }]}
            onSubmit={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
            onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
          />
        </Box>
      </Surface>
    )
  }
  return null
}

export function renderRebackupSubtitle(
  defaultSubtitle: React.ReactNode,
  vaultRouted: boolean,
): React.ReactNode {
  if (!vaultRouted) return defaultSubtitle
  return <Text color={theme.textSubtle}>{defaultSubtitle} Routed through this token's Vault.</Text>
}
