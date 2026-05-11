import type { Address } from 'viem'
import { createErc8004PublicClient } from '../../../registry/erc8004.js'
import { discoverPriorVaultFromTokenOwner, isAgentInVault } from '../../../registry/vault.js'
import type { ProfileUpdates, Step } from '../../identityHubReducer.js'
import { isCustodyEditStep } from './CustodyEditFlow.js'
import { resolveVaultAddress } from './custodyEffects.js'
import type { CustodyFlowDeps } from './custodyFlowTypes.js'
import { humanOwnerAddress } from './custodyFlowHelpers.js'

export function createCustodyFlowActions({
  config,
  setStep,
  handleStepError,
  guardOwnership,
  triggerRebackup,
}: CustodyFlowDeps): {
  beginVaultDeposit: (currentStep: Step, returnTo: Step, profileUpdates: ProfileUpdates) => void
  beginVaultUnwrap: (currentStep: Step, returnTo: Step, profileUpdates: ProfileUpdates) => void
  beginWithdrawToken: (currentStep: Step, returnTo: Step, returnContext?: 'ens' | 'simple-exit') => void
  beginReturnToVault: (currentStep: Step, returnTo: Step, vaultAddress: Address) => void
} {
  const beginVaultDeposit = (currentStep: Step, returnTo: Step, profileUpdates: ProfileUpdates): void => {
    if (!isCustodyEditStep(currentStep) || currentStep.kind !== 'custody-advanced-confirm') return
    const vaultAddress = resolveVaultAddress(currentStep.identity, config?.erc8004?.operatorVaults)
    const expectedOwnerForDiscovery = humanOwnerAddress(currentStep.identity)
    if (!vaultAddress) {
      const registry = currentStep.registry
      ;(async () => {
        try {
          const client = createErc8004PublicClient(registry)
          const probe = await discoverPriorVaultFromTokenOwner({
            client,
            registry: registry.identityRegistryAddress,
            agentId: BigInt(currentStep.identity.agentId ?? '0'),
            expectedOwner: expectedOwnerForDiscovery,
          })
          if (probe.found) {
            const recoveredVault = probe.vaultAddress
            const recoveredProfileUpdates = withVaultProfileUpdates(profileUpdates, recoveredVault)
            const status = await isAgentInVault({
              client,
              vaultAddress: recoveredVault,
              registry: registry.identityRegistryAddress,
              agentId: BigInt(currentStep.identity.agentId ?? '0'),
            })
            if (status.inVault && status.ownerAddress?.toLowerCase() === expectedOwnerForDiscovery.toLowerCase()) {
              triggerRebackup(returnTo, recoveredProfileUpdates, { vaultAddress: recoveredVault })
              return
            }
            if (status.inVault) {
              handleStepError(
                new Error(`Recovered Vault ${recoveredVault} holds the token, but the vault-level depositor is ${status.ownerAddress ?? 'unknown'}, not your wallet ${expectedOwnerForDiscovery}. Mid-flow recovery requires the original depositor's wallet to call vault.unwrap.`),
                { kind: 'custody-model', identity: currentStep.identity, registry, returnTo },
              )
              return
            }
            setStep({
              kind: 'custody-vault-deposit-tx',
              identity: currentStep.identity,
              registry,
              vaultAddress: recoveredVault,
              profileUpdates: recoveredProfileUpdates,
              returnTo,
            })
            return
          }
        } catch {
          void 0
        }
        setStep({
          kind: 'custody-vault-deploy-tx',
          identity: currentStep.identity,
          registry,
          profileUpdates,
          returnTo,
        })
      })()
      return
    }
    const expectedOwner = humanOwnerAddress(currentStep.identity)
    const registry = currentStep.registry
    ;(async () => {
      try {
        const client = createErc8004PublicClient(registry)
        const vaultProfileUpdates = withVaultProfileUpdates(profileUpdates, vaultAddress)
        const status = await isAgentInVault({
          client,
          vaultAddress,
          registry: registry.identityRegistryAddress,
          agentId: BigInt(currentStep.identity.agentId ?? '0'),
        })
        if (status.inVault && status.ownerAddress?.toLowerCase() === expectedOwner.toLowerCase()) {
          triggerRebackup(returnTo, vaultProfileUpdates, { vaultAddress })
          return
        }
        if (status.inVault) {
          handleStepError(
            new Error(`Token is held by the Vault, but the vault-level owner is ${status.ownerAddress ?? 'unknown'}, not your wallet ${expectedOwner}. Recovery requires that wallet to call vault.unwrap.`),
            { kind: 'custody-model', identity: currentStep.identity, registry, returnTo },
          )
          return
        }
        setStep({
          kind: 'custody-vault-deposit-tx',
          identity: currentStep.identity,
          registry,
          vaultAddress,
          profileUpdates: vaultProfileUpdates,
          returnTo,
        })
      } catch (err: unknown) {
        setStep({
          kind: 'custody-vault-deposit-tx',
          identity: currentStep.identity,
          registry,
          vaultAddress,
          profileUpdates: withVaultProfileUpdates(profileUpdates, vaultAddress),
          returnTo,
        })
        void err
      }
    })()
  }

  const beginWithdrawToken = (currentStep: Step, returnTo: Step, returnContext?: 'ens' | 'simple-exit'): void => {
    if (!isCustodyEditStep(currentStep) && currentStep.kind !== 'edit-profile-ens') return
    const vaultAddress = resolveVaultAddress(currentStep.identity, config?.erc8004?.operatorVaults)
    if (!vaultAddress) {
      handleStepError(
        new Error('No Vault is recorded for this identity. There is nothing to withdraw.'),
        { kind: 'custody-model', identity: currentStep.identity, registry: currentStep.registry, returnTo },
      )
      return
    }
    const depositor = humanOwnerAddress(currentStep.identity)
    const activeAgentId = currentStep.identity.agentId
    if (!activeAgentId) {
      handleStepError(
        new Error('This identity does not have an ERC-8004 token ID. There is nothing to withdraw.'),
        { kind: 'custody-model', identity: currentStep.identity, registry: currentStep.registry, returnTo },
      )
      return
    }
    setStep({
      kind: 'custody-vault-withdraw-discovering',
      identity: currentStep.identity,
      registry: currentStep.registry,
      vaultAddress,
      returnTo,
      ...(returnContext ? { returnContext } : {}),
    })
    ;(async () => {
      const client = createErc8004PublicClient(currentStep.registry)
      try {
        const status = await isAgentInVault({
          client,
          vaultAddress,
          registry: currentStep.registry.identityRegistryAddress,
          agentId: BigInt(activeAgentId),
        })
        if (status.inVault) {
          if (status.ownerAddress && status.ownerAddress.toLowerCase() !== depositor.toLowerCase()) {
            handleStepError(
              new Error(`Vault holds token #${activeAgentId} but recorded the depositor as ${status.ownerAddress}, not your wallet ${depositor}. Only the original depositor can withdraw.`),
              { kind: 'custody-model', identity: currentStep.identity, registry: currentStep.registry, returnTo },
            )
            return
          }
          setStep({
            kind: 'custody-vault-withdraw-tx',
            identity: currentStep.identity,
            registry: currentStep.registry,
            vaultAddress,
            agentId: activeAgentId,
            returnTo,
            ...(returnContext ? { returnContext } : {}),
          })
          return
        }
        handleStepError(
          new Error(`Token #${activeAgentId} is not currently in the Vault. There is nothing to withdraw; the token is already with the owner wallet.`),
          { kind: 'custody-model', identity: currentStep.identity, registry: currentStep.registry, returnTo },
        )
      } catch (err: unknown) {
        handleStepError(err, { kind: 'custody-model', identity: currentStep.identity, registry: currentStep.registry, returnTo })
      }
    })()
  }

  const beginVaultUnwrap = (currentStep: Step, returnTo: Step, profileUpdates: ProfileUpdates): void => {
    if (!isCustodyEditStep(currentStep) || currentStep.kind !== 'custody-simple-confirm') return
    const vaultAddress = resolveVaultAddress(currentStep.identity, config?.erc8004?.operatorVaults)
    if (!vaultAddress) {
      triggerRebackup(returnTo, profileUpdates, { useVault: false })
      return
    }
    ;(async () => {
      const allowed = await guardOwnership(currentStep.identity, currentStep.registry, 'vault-level-owner', returnTo)
      if (!allowed) return
      const agentIds = currentStep.identity.agentId ? [currentStep.identity.agentId] : []
      setStep({
        kind: 'custody-vault-unwrap-tx',
        identity: currentStep.identity,
        registry: currentStep.registry,
        vaultAddress,
        profileUpdates,
        returnTo,
        agentIds,
      })
    })()
  }

  const beginReturnToVault = (currentStep: Step, returnTo: Step, vaultAddress: Address): void => {
    if (!isCustodyEditStep(currentStep)) return
    setStep({
      kind: 'custody-vault-deposit-tx',
      identity: currentStep.identity,
      registry: currentStep.registry,
      vaultAddress,
      profileUpdates: withVaultProfileUpdates({}, vaultAddress),
      returnTo,
    })
  }

  return {
    beginVaultDeposit,
    beginVaultUnwrap,
    beginWithdrawToken,
    beginReturnToVault,
  }
}

function withVaultProfileUpdates(profileUpdates: ProfileUpdates, vaultAddress: Address): ProfileUpdates {
  return {
    ...profileUpdates,
    operatorVaultAddress: vaultAddress,
  }
}
