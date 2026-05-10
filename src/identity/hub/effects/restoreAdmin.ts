import { getAddress, type Address } from 'viem'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { saveConfig } from '../../../storage/config.js'
import {
  normalizeErc8004RegistryConfig,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { registryConfigFromConfig } from '../../registry/registryConfig.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import {
  sendBrowserWalletTransaction,
} from '../../wallet/browserWallet.js'
import {
  encodeResolverApprovalChanges,
  verifyResolverApprovalsLanded,
  type RecordsFixPlan,
} from '../reconciliation/index.js'
import type { Step } from '../identityHubReducer.js'
import type { EffectCallbacks } from './types.js'
import { awaitOptionalReceipt } from './receipts.js'
import { createMainnetEnsPublicClient } from './ens/transactions.js'

export async function runRestoreRegistrySubmit(
  value: string,
  step: Extract<Step, { kind: 'restore-registry' }>,
  config: EthagentConfig | undefined,
  onConfigChange: ((config: EthagentConfig) => void) | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const resolution = registryConfigFromConfig(config)
  const registry = normalizeErc8004RegistryConfig({
    chainId: resolution.chainId,
    rpcUrl: resolution.config?.rpcUrl ?? resolution.defaultRpcUrl,
    identityRegistryAddress: value.trim(),
  })
  if (config && onConfigChange) {
    const next: EthagentConfig = {
      ...config,
      erc8004: {
        chainId: registry.chainId,
        rpcUrl: registry.rpcUrl,
        identityRegistryAddress: registry.identityRegistryAddress,
      },
    }
    await saveConfig(next)
    onConfigChange(next)
  }
  callbacks.onStep({ kind: 'restore-discovering', ownerHandle: step.ownerHandle, registry, purpose: step.purpose })
}

export async function runFixRecordsSubmit(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  plan: RecordsFixPlan
  callbacks: EffectCallbacks
}): Promise<void> {
  const baseState = (args.identity.state ?? {}) as Record<string, unknown>
  const ensName = args.plan.ensName ?? (typeof baseState.ensName === 'string' ? baseState.ensName.trim() : '')
  if (!ensName) throw new Error('Cannot fix records: identity has no ENS subdomain')
  const missing: Address[] = []
  const stale: Address[] = []
  for (const item of args.plan.items) {
    if (item.kind === 'missing-approval') missing.push(item.address)
    else if (item.kind === 'stale-approval') stale.push(item.address)
  }
  if (missing.length === 0 && stale.length === 0) return
  const encoded = await encodeResolverApprovalChanges({
    ensName,
    diff: { added: missing, removed: stale },
  })
  if (!encoded) return
  const ownerAddressRaw = readOwnerAddressField(baseState) ?? args.identity.ownerAddress ?? args.identity.address
  const ownerAddress = getAddress(ownerAddressRaw)
  const tx = await sendBrowserWalletTransaction({
    chainId: 1,
    expectedAccount: ownerAddress,
    to: encoded.resolverAddress,
    data: encoded.data,
    onReady: args.callbacks.onWalletReady,
    purpose: 'reconcile-resolver-approvals',
  })
  args.callbacks.onWalletReady(null)
  const client = createMainnetEnsPublicClient()
  await awaitOptionalReceipt(client, tx.txHash, 'Resolver approval reconciliation')
  await verifyResolverApprovalsLanded({
    ensName,
    ownerAddress: ownerAddress,
    resolverAddress: encoded.resolverAddress,
    added: encoded.added,
    removed: encoded.removed,
    client,
  })
}
