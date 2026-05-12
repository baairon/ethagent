import { useEffect } from 'react'
import { createErc8004PublicClient } from '../../registry/erc8004.js'
import { confirmAgentInVault } from '../../registry/vault.js'
import { invalidateOwnershipCache } from '../shared/reconciliation/index.js'
import type { ProfileUpdates } from '../identityHubReducer.js'
import type { CustodyFlowDeps } from './types.js'
import { humanOwnerAddress } from './helpers.js'
import {
  runVaultDeployTransaction,
  runVaultDepositTransaction,
  runVaultUnwrapTransaction,
  runVaultWithdrawTransaction,
} from './transactions.js'

export function useCustodyTransactionEffects({
  step,
  setStep,
  callbacks,
  handleStepError,
  triggerRebackup,
  refreshReconciliation,
}: CustodyFlowDeps): void {
  useEffect(() => {
    if (step.kind !== 'custody-vault-deploy-tx') return
    let cancelled = false
    if (!step.identity.agentId) {
      handleStepError(
        new Error('Cannot deploy Vault: agent token ID is missing'),
        { kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo },
      )
      return () => { cancelled = true }
    }
    runVaultDeployTransaction({
      registry: step.registry,
      walletAddress: humanOwnerAddress(step.identity),
      agentId: BigInt(step.identity.agentId),
      callbacks,
      flowId: 'advanced-custody',
    })
      .then(async ({ vaultAddress }) => {
        if (cancelled) return
        setStep({
          kind: 'custody-vault-deposit-tx',
          identity: step.identity,
          registry: step.registry,
          vaultAddress,
          profileUpdates: withVaultProfileUpdates(step.profileUpdates, vaultAddress),
          returnTo: step.returnTo,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        handleStepError(err, { kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'custody-vault-deposit-tx') return
    let cancelled = false
    runVaultDepositTransaction({
      identity: step.identity,
      registry: step.registry,
      vaultAddress: step.vaultAddress,
      callbacks,
      flowId: 'advanced-custody',
    })
      .then(async () => {
        if (cancelled) return
        invalidateOwnershipCache()
        refreshReconciliation()
        const probeClient = createErc8004PublicClient(step.registry)
        const expectedOwner = humanOwnerAddress(step.identity)
        const status = await confirmAgentInVault({
          client: probeClient,
          vaultAddress: step.vaultAddress,
          registry: step.registry.identityRegistryAddress,
          agentId: BigInt(step.identity.agentId ?? '0'),
        })
        if (cancelled) return
        if (status.ownerAddress.toLowerCase() !== expectedOwner.toLowerCase()) {
          throw new Error(
            `Vault holds the token but recorded the depositor as ${status.ownerAddress} instead of ${expectedOwner}. Use Withdraw Token to recover.`,
          )
        }
        triggerRebackup(step.returnTo ?? { kind: 'menu' }, step.profileUpdates, { vaultAddress: step.vaultAddress })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        handleStepError(err, { kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'custody-vault-withdraw-tx') return
    let cancelled = false
    runVaultWithdrawTransaction({
      identity: step.identity,
      registry: step.registry,
      vaultAddress: step.vaultAddress,
      callbacks,
      ...(step.agentId ? { agentId: BigInt(step.agentId) } : {}),
    })
      .then(({ recipient }) => {
        if (cancelled) return
        invalidateOwnershipCache()
        refreshReconciliation()
        setStep({
          kind: 'custody-vault-withdraw-done',
          identity: step.identity,
          registry: step.registry,
          vaultAddress: step.vaultAddress,
          recipient,
          returnTo: step.returnTo,
          ...(step.returnContext ? { returnContext: step.returnContext } : {}),
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        handleStepError(err, { kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
      })
    return () => { cancelled = true }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'custody-vault-unwrap-tx') return
    let cancelled = false
    const agentIds = step.agentIds && step.agentIds.length > 0
      ? step.agentIds
      : (step.identity.agentId ? [step.identity.agentId] : [])
    ;(async () => {
      try {
        for (const agentIdStr of agentIds) {
          if (cancelled) return
          await runVaultUnwrapTransaction({
            identity: step.identity,
            registry: step.registry,
            vaultAddress: step.vaultAddress,
            callbacks,
            flowId: 'simple-custody',
            agentId: BigInt(agentIdStr),
          })
        }
        if (cancelled) return
        invalidateOwnershipCache()
        refreshReconciliation()
        triggerRebackup(step.returnTo ?? { kind: 'menu' }, step.profileUpdates, { useVault: false })
      } catch (err: unknown) {
        if (cancelled) return
        handleStepError(err, { kind: 'custody-model', identity: step.identity, registry: step.registry, returnTo: step.returnTo })
      }
    })()
    return () => { cancelled = true }
  }, [step])
}

function withVaultProfileUpdates(profileUpdates: ProfileUpdates, vaultAddress: `0x${string}`): ProfileUpdates {
  return {
    ...profileUpdates,
    operatorVaultAddress: vaultAddress,
  }
}
