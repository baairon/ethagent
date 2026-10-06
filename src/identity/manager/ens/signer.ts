import { getAddress, type Address, type Hex } from 'viem'
import {
  sendBrowserWalletTransaction,
  type BrowserWalletSession,
  type WalletPurpose,
} from '../../wallet/browserWallet.js'
import type { LocalKeySender } from '../../wallet/localKeyWallet.js'
import type { EffectCallbacks } from '../shared/effects/types.js'

export type EnsTransactionRequest = {
  to: Address
  data: Hex
  gas: Hex
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
  purpose: WalletPurpose
  tokenChainName?: string
  flowId?: string
  flowStep?: number
}

// Who signs a mainnet ENS transaction: the browser wallet (one tab per request, or one
// session for a whole flow) or the operator key. Gas is always estimated from this
// account, never assumed to be the agent's owner.
export type EnsSigner = {
  kind: 'browser' | 'operator'
  account: Address
  send: (tx: EnsTransactionRequest) => Promise<{ txHash: Hex }>
}

export function browserEnsSigner(args: {
  account: Address
  callbacks: EffectCallbacks
  session?: BrowserWalletSession
}): EnsSigner {
  const account = getAddress(args.account)
  return {
    kind: 'browser',
    account,
    async send(tx) {
      if (args.session) {
        const result = await args.session.sendTransaction({
          chainId: 1,
          expectedAccount: account,
          to: tx.to,
          data: tx.data,
          gas: tx.gas,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          purpose: tx.purpose,
          ...(tx.tokenChainName ? { tokenChainName: tx.tokenChainName } : {}),
          ...(tx.flowId ? { flowId: tx.flowId } : {}),
          ...(typeof tx.flowStep === 'number' ? { flowStep: tx.flowStep } : {}),
        })
        return { txHash: result.txHash }
      }
      const result = await sendBrowserWalletTransaction({
        chainId: 1,
        expectedAccount: account,
        to: tx.to,
        data: tx.data,
        gas: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        purpose: tx.purpose,
        onReady: args.callbacks.onWalletReady,
        ...(args.callbacks.signal ? { signal: args.callbacks.signal } : {}),
        ...(tx.tokenChainName ? { tokenChainName: tx.tokenChainName } : {}),
      })
      args.callbacks.onWalletReady(null)
      return { txHash: result.txHash }
    },
  }
}

export function operatorEnsSigner(sender: LocalKeySender): EnsSigner {
  if (sender.chainId !== 1) throw new Error('ENS transactions are signed on Ethereum Mainnet (chain 1).')
  return {
    kind: 'operator',
    account: getAddress(sender.account),
    async send(tx) {
      return sender.send({
        to: tx.to,
        data: tx.data,
        gas: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      })
    },
  }
}
