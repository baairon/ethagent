import { numberToHex } from 'viem'
import type {
  PreparedGasFee,
  PrepareTransactionGasFeeArgs,
  PrepareTransactionGasFeeClient,
} from './types.js'

const GAS_FEE_PREP_MAX_ATTEMPTS = 5
const GAS_FEE_PREP_DELAY_MS = 1500

function gasFeeDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function prepareTransactionGasFee(args: PrepareTransactionGasFeeArgs): Promise<PreparedGasFee> {
  let lastErr: unknown
  for (let attempt = 0; attempt < GAS_FEE_PREP_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await gasFeeDelay(GAS_FEE_PREP_DELAY_MS)
    try {
      const estimateArgs: Parameters<PrepareTransactionGasFeeClient['estimateGas']>[0] = {
        account: args.account,
        data: args.data,
        ...(args.to ? { to: args.to } : {}),
        ...(args.value !== undefined ? { value: args.value } : {}),
      }
      const [gas, fees] = await Promise.all([
        args.client.estimateGas(estimateArgs),
        args.client.estimateFeesPerGas(),
      ])
      const gasWithBuffer = (gas * 12n) / 10n
      return {
        gas: numberToHex(gasWithBuffer),
        maxFeePerGas: numberToHex(fees.maxFeePerGas),
        maxPriorityFeePerGas: numberToHex(fees.maxPriorityFeePerGas),
      }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('failed to prepare transaction gas/fee')
}
