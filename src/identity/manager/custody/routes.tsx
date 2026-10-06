import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import { BusyScreen } from '../shared/components/BusyScreen.js'
import { FieldList } from '../shared/components/FieldRow.js'
import { shortAddress } from '../shared/model/format.js'
import { networkName } from '../shared/model/network.js'
import type { CustodyFlowDeps } from './types.js'
import { humanOwnerAddress } from './helpers.js'

export function renderCustodyStep({
  step,
  setStep,
  walletSession,
}: CustodyFlowDeps): React.ReactElement | null {
  if (step.kind === 'custody-vault-deploy-tx') {
    return (
      <WalletApprovalScreen
        title="Create Your Vault"
        subtitle={`Deploys your Vault contract on ${networkName(step.registry.chainId)}. It needs gas.`}
        walletSession={walletSession}
        label="Waiting for your wallet…"
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-deposit-tx') {
    return (
      <WalletApprovalScreen
        title="Move Token into Vault"
        subtitle={`Moves token #${step.identity.agentId ?? ''} into your Vault on ${networkName(step.registry.chainId)}. It needs gas.`}
        walletSession={walletSession}
        label="Waiting for your wallet…"
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-withdraw-discovering') {
    return (
      <BusyScreen
        title="Checking Vault"
        subtitle={`Looking for tokens in your Vault on ${networkName(step.registry.chainId)}.`}
        label="Reading the Vault…"
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-withdraw-tx') {
    const targetAgentId = step.agentId ?? step.identity.agentId ?? ''
    return (
      <WalletApprovalScreen
        title="Withdraw Token"
        subtitle={`Moves token #${targetAgentId} from the Vault back to your owner wallet. It needs gas.`}
        walletSession={walletSession}
        label="Waiting for your wallet…"
        onCancel={() => setStep({ kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }
  if (step.kind === 'custody-vault-withdraw-pick-token') {
    const activeId = step.identity.agentId
    const options = step.tokens.map(t => ({
      value: t.agentId,
      label: `Token #${t.agentId}`,
      ...(activeId && t.agentId === activeId ? { hint: 'This agent' } : {}),
    }))
    return (
      <Surface
        title="Choose a Token to Withdraw"
        subtitle={`${step.tokens.length} tokens are in this Vault on ${networkName(step.registry.chainId)}. The one you pick returns to your owner wallet.`}
        footer={<Text color={theme.dim}>↵ select · esc back</Text>}
      >
        <Box>
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
        title="Token Back in Your Wallet"
        subtitle={`The token is now held by ${shortAddress(step.recipient)}.`}
        footer={<Text color={theme.dim}>↵ select · esc back</Text>}
      >
        <Box>
          <Select<'return-to-vault' | 'keep-out'>
            options={[
              { value: 'return-to-vault', label: 'Return It to the Vault', hint: 'Needs one more transaction' },
              { value: 'keep-out', label: 'Keep It Out for Now', role: 'utility' },
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
        title="Switch to Simple"
        subtitle={`Moves token #${step.identity.agentId ?? ''} out of the Vault and back to your owner wallet. It needs gas.`}
        walletSession={walletSession}
        label="Waiting for your wallet…"
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
        subtitle="A Vault holds your token. Operator wallets can now save snapshots."
        footer={<Text color={theme.dim}>↵ continue</Text>}
      >
        <FieldList fields={[
          step.vaultAddress ? { label: 'Vault', value: shortAddress(step.vaultAddress) } : null,
          { label: 'Owner wallet', value: shortAddress(ownerWallet) },
          { label: 'Operators', value: operatorCount === 0 ? 'None yet' : `${operatorCount} approved`, ...(operatorCount === 0 ? { valueColor: theme.dim } : {}) },
        ]} />
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
        subtitle="The token is back in your owner wallet."
        footer={<Text color={theme.dim}>↵ continue</Text>}
      >
        <FieldList fields={[{ label: 'Owner wallet', value: shortAddress(ownerWallet) }]} />
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
