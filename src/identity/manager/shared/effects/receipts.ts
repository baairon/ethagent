import type { Hex, PublicClient, TransactionReceipt } from 'viem'
import type { PendingTxKind } from '../../../../storage/config.js'
import { clearPendingTx, recordPendingTx } from '../../../../storage/config.js'
import { cancellable } from '../../../ens/ensLookup/client.js'

export async function awaitConfirmedReceipt(
  client: Pick<PublicClient, 'waitForTransactionReceipt'>,
  hash: Hex,
  action: string,
  pending?: { kind: PendingTxKind; chainId: number },
  signal?: AbortSignal,
): Promise<TransactionReceipt> {
  if (pending) {
    await recordPendingTx({
      hash,
      kind: pending.kind,
      chainId: pending.chainId,
      submittedAt: new Date().toISOString(),
    }).catch(() => null)
  }
  try {
    const receipt = await cancellable<TransactionReceipt>(client.waitForTransactionReceipt({ hash, timeout: 0 }), signal)
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
