import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import {
  createErc8004PublicClient,
  type Erc8004RegistryConfig,
} from '../../../registry/erc8004.js'
import {
  OPERATOR_VAULT_ABI,
  encodeSetMetadataOperator,
  readMetadataOperators,
} from '../../../registry/operatorVault.js'
import {
  sendBrowserWalletTransaction,
  type WalletPurpose,
} from '../../../wallet/browserWallet.js'
import {
  computeApprovalDiff,
  encodeResolverApprovalChanges,
  verifyResolverApprovalsLanded,
  type ApprovalDiff,
} from '../../reconciliation/index.js'
import { normalizeApprovedOperatorWallets } from '../../operatorWallets.js'
import { readOwnerAddressField } from '../../../identityCompat.js'
import { localContinuitySnapshotContentHashes } from '../../../continuity/storage.js'
import { updatePublishedContinuitySnapshotContentHashes } from '../../../continuity/snapshots.js'
import type { EffectCallbacks } from '../types.js'
import { awaitConfirmedReceipt, awaitOptionalReceipt } from '../receipts.js'
import { createMainnetEnsPublicClient } from '../ens/transactions.js'

export function resolverSyncWarningMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function appendResolverSyncWarning(message: string, warning: string | null): string {
  if (!warning) return message
  return `${message}\n\nWarning: ${warning}`
}

export async function syncResolverApprovalsAfterOwnerSave(args: {
  beforeIdentity: EthagentIdentity
  afterIdentity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress?: Address
  callbacks: EffectCallbacks
}): Promise<void> {
  const beforeState = (args.beforeIdentity.state ?? {}) as Record<string, unknown>
  const afterState = (args.afterIdentity.state ?? {}) as Record<string, unknown>
  const ensName = typeof afterState.ensName === 'string' ? afterState.ensName.trim() : ''
  const before = normalizeApprovedOperatorWallets(beforeState.approvedOperatorWallets)
  const after = normalizeApprovedOperatorWallets(afterState.approvedOperatorWallets)
  const diff = computeApprovalDiff(before, after)
  if (diff.added.length === 0 && diff.removed.length === 0) return

  const ownerAddressRaw = readOwnerAddressField(afterState) ?? args.afterIdentity.ownerAddress ?? args.afterIdentity.address
  const ownerAddress = getAddress(ownerAddressRaw)

  if (ensName) {
    let encoded
    try {
      encoded = await encodeResolverApprovalChanges({ ensName, diff })
    } catch {
      encoded = null
    }
    if (encoded) {
      const purpose: WalletPurpose = diff.removed.length > 0 && diff.added.length === 0
        ? 'revoke-operator-wallet-resolver'
        : 'authorize-operator-wallet-resolver'

      const tx = await sendBrowserWalletTransaction({
        chainId: 1,
        expectedAccount: ownerAddress,
        to: encoded.resolverAddress,
        data: encoded.data,
        onReady: args.callbacks.onWalletReady,
        purpose,
      })
      args.callbacks.onWalletReady(null)
      const client = createMainnetEnsPublicClient()
      await awaitOptionalReceipt(client, tx.txHash, 'Resolver delegation sync')
      await verifyResolverApprovalsLanded({
        ensName,
        ownerAddress: ownerAddress,
        resolverAddress: encoded.resolverAddress,
        added: encoded.added,
        removed: encoded.removed,
        client,
      })
    }
  }

  await syncVaultMetadataOperatorsAfterOwnerSave({
    afterIdentity: args.afterIdentity,
    registry: args.registry,
    vaultAddress: args.vaultAddress,
    diff,
    ownerAddress,
    callbacks: args.callbacks,
  })
}

export async function syncVaultMetadataOperatorsAfterOwnerSave(args: {
  afterIdentity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress: Address | undefined
  diff: ApprovalDiff
  ownerAddress: Address
  callbacks: EffectCallbacks
}): Promise<void> {
  if (!args.vaultAddress) return
  const agentIdRaw = args.afterIdentity.agentId
  if (!agentIdRaw) return
  const agentId = BigInt(agentIdRaw)
  const registryAddress = getAddress(args.registry.identityRegistryAddress)
  const vaultAddress = getAddress(args.vaultAddress)
  const probeClient = createErc8004PublicClient(args.registry)
  let depositor: Address | undefined
  try {
    depositor = await probeClient.readContract({
      address: vaultAddress,
      abi: OPERATOR_VAULT_ABI,
      functionName: 'agentOwner',
      args: [registryAddress, agentId],
    }) as Address
  } catch {
    depositor = undefined
  }
  if (!depositor || depositor.toLowerCase() !== args.ownerAddress.toLowerCase()) return

  const operations: Array<{ operator: Address; approved: boolean }> = []
  for (const operator of args.diff.added) operations.push({ operator: getAddress(operator), approved: true })
  for (const operator of args.diff.removed) operations.push({ operator: getAddress(operator), approved: false })
  if (operations.length === 0) return

  for (const op of operations) {
    const encoded = encodeSetMetadataOperator({
      registry: registryAddress,
      agentId,
      operator: op.operator,
      approved: op.approved,
      vaultAddress,
    })
    const tx = await sendBrowserWalletTransaction({
      chainId: args.registry.chainId,
      expectedAccount: args.ownerAddress,
      to: encoded.to,
      data: encoded.data,
      onReady: args.callbacks.onWalletReady,
      purpose: 'sync-operator-vault',
    })
    args.callbacks.onWalletReady(null)
    await awaitConfirmedReceipt(probeClient, tx.txHash, 'Vault operator sync')
  }

  const VERIFY_MAX_ATTEMPTS = 5
  const VERIFY_DELAY_MS = 1500
  let lastMismatch: { op: typeof operations[number]; observed: boolean } | undefined
  for (let attempt = 0; attempt < VERIFY_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, VERIFY_DELAY_MS))
    const final = await readMetadataOperators({
      client: probeClient,
      vaultAddress,
      registry: registryAddress,
      agentId,
      candidates: operations.map(o => o.operator),
    })
    lastMismatch = undefined
    for (const op of operations) {
      const observed = Boolean(final[op.operator])
      if (observed !== op.approved) {
        lastMismatch = { op, observed }
        break
      }
    }
    if (!lastMismatch) return
  }
  if (lastMismatch) {
    throw new Error(
      lastMismatch.op.approved
        ? `Vault operator authorization didn't land for ${lastMismatch.op.operator}. Your wallet may have rejected the inner transaction; retry the save to apply it.`
        : `Vault operator revocation didn't land for ${lastMismatch.op.operator}. Your wallet may have rejected the inner transaction; retry the save to apply it.`,
    )
  }
}

export async function markCurrentContinuityFilesPublished(identity: EthagentIdentity): Promise<void> {
  const cid = identity.backup?.cid
  if (!cid) return
  const contentHashes = await localContinuitySnapshotContentHashes(identity)
  await updatePublishedContinuitySnapshotContentHashes(identity, cid, contentHashes).catch(() => null)
}
