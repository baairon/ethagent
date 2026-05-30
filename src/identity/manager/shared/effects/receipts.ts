import type { Hex, PublicClient } from 'viem'
import type { PendingTxKind } from '../../../../storage/config.js'
import { clearPendingTx, recordPendingTx } from '../../../../storage/config.js'

export async function awaitConfirmedReceipt(
  client: Pick<PublicClient, 'waitForTransactionReceipt'>,
  hash: Hex,
  action: string,
  pending?: { kind: PendingTxKind; chainId: number },
): ReturnType<PublicClient['waitForTransactionReceipt']> {
  if (pending) {
    await recordPendingTx({
      hash,
      kind: pending.kind,
      chainId: pending.chainId,
      submittedAt: new Date().toISOString(),
    }).catch(() => null)
  }
  try {
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      throw new Error(`${action} reverted onchain (tx ${hash}). Check the transaction on a block explorer for the revert reason.`)
    }
    return receipt
  } finally {
    if (pending) {
      await clearPendingTx().catch(() => null)
    }
  }
}

export async function awaitOptionalReceipt(
  client: Pick<PublicClient, 'waitForTransactionReceipt'>,
  hash: Hex,
  action: string,
): Promise<void> {
  let receipt
  try {
    receipt = await client.waitForTransactionReceipt({ hash })
  } catch {
    return
  }
  if (receipt.status !== 'success') {
    throw new Error(`${action} reverted onchain (tx ${hash}).`)
  }
}
