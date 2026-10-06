import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import {
  blockTimeMsForChain,
  createErc8004PublicClient,
  type Erc8004RegistryConfig,
} from '../../../registry/erc8004.js'
import { pacedConfirm, PacedTimeoutError } from '../../../../net/paced.js'
import {
  VAULT_ABI,
  encodeSetMetadataOperator,
  readMetadataOperators,
} from '../../../registry/vault.js'
import { prepareTransactionGasFee, sendBrowserWalletTransaction } from '../../../wallet/browserWallet.js'
import {
  computeApprovalDiff,
  type ApprovalDiff,
} from '../reconciliation/index.js'
import { normalizeApprovedOperatorWallets } from '../operatorWallets.js'
import { readOwnerAddressField } from '../../../identityCompat.js'
import {
  continuitySnapshotContentHashesFromSources,
  localContinuitySnapshotContentHashes,
} from '../../../continuity/storage.js'
import type { ContinuityFiles, ContinuitySkillsTree } from '../../../continuity/envelope.js'
import { updatePublishedContinuitySnapshotContentHashes } from '../../../continuity/snapshots.js'
import { captureSnapshot } from '../../../continuity/snapshotCapture.js'
import type { EffectCallbacks } from './types.js'
import { awaitConfirmedReceipt } from './receipts.js'

export function operatorSyncWarningMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function appendOperatorSyncWarning(message: string, warning: string | null): string {
  if (!warning) return message
  return `${message}\n\nWarning: ${warning}`
}

export async function syncVaultOperatorsAfterOwnerSave(args: {
  beforeIdentity: EthagentIdentity
  afterIdentity: EthagentIdentity
  registry: Erc8004RegistryConfig
  vaultAddress?: Address
  callbacks: EffectCallbacks
  // The save follows a deposit. Each deposit starts a new operator epoch on the Vault,
  // which wipes every approval, so operators that local state still lists are approved
  // again even though the local diff is empty.
  afterDeposit?: boolean
}): Promise<void> {
  const beforeState = (args.beforeIdentity.state ?? {}) as Record<string, unknown>
  const afterState = (args.afterIdentity.state ?? {}) as Record<string, unknown>
  const before = normalizeApprovedOperatorWallets(beforeState.approvedOperatorWallets)
  const after = normalizeApprovedOperatorWallets(afterState.approvedOperatorWallets)
  let diff = computeApprovalDiff(before, after)
  if (args.afterDeposit && args.vaultAddress && args.afterIdentity.agentId && after.length > 0) {
    const onchain = await readMetadataOperators({
      client: createErc8004PublicClient(args.registry),
      vaultAddress: getAddress(args.vaultAddress),
      registry: getAddress(args.registry.identityRegistryAddress),
      agentId: BigInt(args.afterIdentity.agentId),
      candidates: after.map(record => getAddress(record.address)),
    })
    const added = new Map(diff.added.map(address => [address.toLowerCase(), address]))
    for (const [address, approved] of Object.entries(onchain)) {
      if (!approved) added.set(address.toLowerCase(), getAddress(address))
    }
    diff = { added: [...added.values()], removed: diff.removed }
  }
  if (diff.added.length === 0 && diff.removed.length === 0) return

  const ownerAddressRaw = readOwnerAddressField(afterState) ?? args.afterIdentity.ownerAddress ?? args.afterIdentity.address
  const ownerAddress = getAddress(ownerAddressRaw)

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
  // An unanswered read surfaces: skipping the sync on it would leave operators that
  // local state lists as approved without an onchain approval.
  const depositor = await probeClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'agentOwner',
    args: [registryAddress, agentId],
  }) as Address
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
    const gasFee = await prepareTransactionGasFee({
      client: probeClient,
      account: args.ownerAddress,
      to: encoded.to,
      data: encoded.data,
    })
    const tx = await sendBrowserWalletTransaction({
      chainId: args.registry.chainId,
      expectedAccount: args.ownerAddress,
      to: encoded.to,
      data: encoded.data,
      ...gasFee,
      onReady: args.callbacks.onWalletReady,
      ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
      purpose: 'sync-operator-vault',
    })
    args.callbacks.onWalletReady(null)
    await awaitConfirmedReceipt(probeClient, tx.txHash, 'Vault operator sync')
  }

  let lastMismatch: { op: typeof operations[number]; observed: boolean } | undefined
  try {
    await pacedConfirm(
      'The operator change',
      async () => {
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
            return { done: false, observed: `${op.operator} ${observed ? 'approved' : 'not approved'}` }
          }
        }
        return { done: true, value: undefined }
      },
      {
        blockTimeMs: blockTimeMsForChain(args.registry.chainId),
        ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
      },
    )
  } catch (err: unknown) {
    if (!(err instanceof PacedTimeoutError) || !lastMismatch) throw err
    const mismatch: { op: typeof operations[number]; observed: boolean } = lastMismatch
    throw new Error(
      mismatch.op.approved
        ? `Vault operator authorization didn't land for ${mismatch.op.operator}. Your wallet may have rejected the inner transaction; retry the save to apply it.`
        : `Vault operator revocation didn't land for ${mismatch.op.operator}. Your wallet may have rejected the inner transaction; retry the save to apply it.`,
    )
  }
}

export async function markCurrentContinuityFilesPublished(
  identity: EthagentIdentity,
  publishedSources?: {
    privateFiles: ContinuityFiles
    agentCard: string
    skills: ContinuitySkillsTree
  },
): Promise<void> {
  const cid = identity.backup?.cid
  if (!cid) return
  const contentHashes = publishedSources
    ? continuitySnapshotContentHashesFromSources(publishedSources)
    : await localContinuitySnapshotContentHashes(identity)
  await updatePublishedContinuitySnapshotContentHashes(identity, cid, contentHashes).catch(() => null)
  if (publishedSources) {
    await captureSnapshot(identity, cid, publishedSources, {
      source: 'save',
      ...(identity.backup?.createdAt ? { createdAt: identity.backup.createdAt } : {}),
      ...(identity.agentCard?.cid ? { agentCardCid: identity.agentCard.cid } : {}),
    })
  }
}
