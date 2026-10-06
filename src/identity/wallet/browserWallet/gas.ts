import { numberToHex } from 'viem'
import { isDefinitiveChainError, pacedConfirm } from '../../../net/paced.js'
import { describeVaultRevert } from '../../registry/vault/errors.js'
import type {
  PreparedGasFee,
  PrepareTransactionGasFeeArgs,
  PrepareTransactionGasFeeClient,
} from './types.js'

const DEFAULT_BLOCK_TIME_MS = 2_000

// Estimates gas and fees, looking again once per new block while the estimate fails for
// a reason a later block can fix (a follower behind the state the call depends on). A
// revert is the chain's answer, so it surfaces at once, named when it is a Vault error.
export async function prepareTransactionGasFee(args: PrepareTransactionGasFeeArgs): Promise<PreparedGasFee> {
  const estimateArgs: Parameters<PrepareTransactionGasFeeClient['estimateGas']>[0] = {
    account: args.account,
    data: args.data,
    ...(args.to ? { to: args.to } : {}),
    ...(args.value !== undefined ? { value: args.value } : {}),
  }
  try {
    return await pacedConfirm(
      'The gas estimate',
      async () => {
        const [gas, fees] = await Promise.all([
          args.client.estimateGas(estimateArgs),
          args.client.estimateFeesPerGas(),
        ])
        const gasWithBuffer = (gas * 12n) / 10n
        return {
          done: true,
          value: {
            gas: numberToHex(gasWithBuffer),
            maxFeePerGas: numberToHex(fees.maxFeePerGas),
            maxPriorityFeePerGas: numberToHex(fees.maxPriorityFeePerGas),
          },
        }
      },
      {
        blockTimeMs: args.blockTimeMs ?? (args.client as { chain?: { blockTime?: number } }).chain?.blockTime ?? DEFAULT_BLOCK_TIME_MS,
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.pause ? { pause: args.pause } : {}),
      },
    )
  } catch (err: unknown) {
    if (isDefinitiveChainError(err)) {
      const vault = describeVaultRevert(err)
      if (vault) throw new Error(`The transaction would be refused: ${vault}.`, { cause: err })
    }
    throw err
  }
}
