import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import { WalletApprovalScreen } from '../../components/WalletApprovalScreen.js'
import { shortAddress } from '../../model/format.js'
import type { Step } from '../../identityHubReducer.js'
import type { CustodyFlowDeps } from './custodyFlowTypes.js'
import { chainLabel, humanOwnerAddress } from './custodyFlowHelpers.js'

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
        subtitle={`Deploying a dedicated Vault for this ERC-8004 token on ${chainLabel(step.registry.chainId)}.`}
        walletSession={walletSession}
        label="waiting for owner wallet transaction..."
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-deposit-tx') {
    return (
      <WalletApprovalScreen
        title="Deposit Token Into Vault"
        subtitle={`Sign one ${chainLabel(step.registry.chainId)} transaction. Sends ERC-8004 token #${step.identity.agentId ?? ''} to its Vault.`}
        walletSession={walletSession}
        label="waiting for token-owner wallet transaction..."
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
          ? `Confirming the Vault holds ERC-8004 token #${targetAgentId} on ${chainLabel(step.registry.chainId)}.`
          : `Checking this identity's recorded Vault on ${chainLabel(step.registry.chainId)}.`}
        footer={<Text color={theme.dim}>esc cancel</Text>}
      >
        <Box marginTop={1}>
          <Text color={theme.textSubtle}>Reading vault state from chain...</Text>
        </Box>
      </Surface>
    )
  }
  if (step.kind === 'custody-vault-withdraw-tx') {
    const targetAgentId = step.agentId ?? step.identity.agentId ?? ''
    return (
      <WalletApprovalScreen
        title="Withdraw Token"
        subtitle={`Unwraps ERC-8004 token #${targetAgentId} from its Vault to your owner wallet on ${chainLabel(step.registry.chainId)}.`}
        walletSession={walletSession}
        label="waiting for owner wallet transaction..."
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-withdraw-pick-token') {
    const activeId = step.identity.agentId
    const options = step.tokens.map(t => ({
      value: t.agentId,
      label: `Token #${t.agentId}${activeId && t.agentId === activeId ? ' (active)' : ''}`,
      hint: 'Withdraw this token to your owner wallet',
    }))
    return (
      <Surface
        title="Pick a Vaulted Token"
        subtitle={`Your wallet has ${step.tokens.length} vaulted tokens on ${chainLabel(step.registry.chainId)}. Pick one to withdraw.`}
        footer={<Text color={theme.dim}>enter select · esc back</Text>}
      >
        <Box marginTop={1}>
          <Select<string>
            options={[
              { value: 'header', role: 'section', label: 'Vaulted Tokens' },
              ...options,
              { value: 'cancel', role: 'section', label: 'Navigation' },
              { value: 'cancel', label: 'Back', hint: 'Return to Custody Mode', role: 'utility' },
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
        subtitle={`Token returned to ${shortAddress(step.recipient)} on ${chainLabel(step.registry.chainId)}. The Vault can be reused for this token.`}
        footer={<Text color={theme.dim}>enter select · esc back</Text>}
      >
        <Box flexDirection="column">
          <Text color={theme.textSubtle}>
            {step.returnContext === 'ens'
              ? 'Use the token with your owner wallet to set ENS records, then return it to the vault to resume Advanced custody.'
              : 'Use the token with your owner wallet for whatever you need, then return it to the vault when finished.'}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Select<'return-to-vault' | 'keep-out'>
            options={[
              { value: 'return-to-vault', role: 'section', label: 'Resume Advanced Custody' },
              { value: 'return-to-vault', label: 'Return Token to Vault', hint: 'Redeposit to this Vault. No redeploy, no operator re-add' },
              { value: 'keep-out', role: 'section', label: 'Later' },
              { value: 'keep-out', label: 'Keep Out For Now', hint: 'Token stays with the owner wallet; redeposit any time from Custody Mode', role: 'utility' },
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
        subtitle={`Sign one ${chainLabel(step.registry.chainId)} transaction. Calls the Vault unwrap function to return ERC-8004 token #${step.identity.agentId ?? ''} to the owner wallet.`}
        walletSession={walletSession}
        label="waiting for owner wallet transaction..."
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
        subtitle="Your token is held in its own Vault. Authorized operator wallets can rotate the agent URI onchain without owner signatures."
        footer={<Text color={theme.dim}>enter continues</Text>}
      >
        <Box flexDirection="column">
          {step.vaultAddress ? <Row label="Vault" value={shortAddress(step.vaultAddress)} /> : null}
          <Row label="Owner Wallet" value={shortAddress(ownerWallet)} />
          <Row label="Operator Wallets" value={operatorCount === 1 ? '1 approved' : `${operatorCount} approved`} />
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>Use Manage Operators to add or revoke operator wallets. Use Withdraw Token to pull this token out of its vault temporarily without dismantling advanced custody.</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Select<'continue'>
            options={[{ value: 'continue', label: 'Return to Custody Mode' }]}
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
        subtitle={`The token is back with the owner wallet. Operator slots are cleared.`}
        footer={<Text color={theme.dim}>enter continues</Text>}
      >
        <Box flexDirection="column">
          <Row label="Owner Wallet" value={shortAddress(ownerWallet)} />
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>Future URI rotations require an owner wallet signature per edit. Switch back to Advanced from Custody Mode at any time.</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Select<'continue'>
            options={[{ value: 'continue', label: 'Return to Custody Mode' }]}
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
