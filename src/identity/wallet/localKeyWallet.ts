import { createWalletClient, getAddress, hexToBigInt, type Address, type Hex, type Transport } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainForId, rpcUrlsForClient } from '../registry/erc8004/chains.js'
import { adaptiveRpcTransport } from '../../net/rpc.js'
import type {
  BrowserWalletSignAndTransaction,
  SignAndTransactionRequest,
} from './browserWallet.js'

export type SignAndTransactionRunner = <TPrepared>(
  req: SignAndTransactionRequest<TPrepared>,
) => Promise<BrowserWalletSignAndTransaction<TPrepared>>

export type LocalKeyTransaction = {
  to: Address
  data: Hex
  value?: Hex
  gas?: Hex
  maxFeePerGas?: Hex
  maxPriorityFeePerGas?: Hex
}

export type LocalKeySender = {
  account: Address
  chainId: number
  send: (tx: LocalKeyTransaction) => Promise<{ txHash: Hex }>
}

// The operator key signs and broadcasts without a browser. The broadcast goes through
// the adaptive transport, which sends a raw transaction to exactly one endpoint and
// never repeats it, and the gas and fees the caller prepared are used as given.
export function createLocalKeySender(args: {
  privateKey: Hex
  chainId: number
  rpcUrl?: string
  transport?: Transport
}): LocalKeySender {
  const account = privateKeyToAccount(args.privateKey)
  const chain = chainForId(args.chainId)
  if (!chain) throw new Error(`Unsupported chain id ${args.chainId} for local-key signing`)
  const transport = args.transport ?? adaptiveRpcTransport(rpcUrlsForClient({
    chainId: args.chainId,
    rpcUrl: args.rpcUrl ?? chain.rpcUrls.default.http[0]!,
  }))
  const walletClient = createWalletClient({ account, chain, transport })
  return {
    account: account.address,
    chainId: args.chainId,
    async send(tx) {
      const txHash = await walletClient.sendTransaction({
        to: tx.to,
        data: tx.data,
        ...(tx.value ? { value: hexToBigInt(tx.value) } : {}),
        ...(tx.gas ? { gas: hexToBigInt(tx.gas) } : {}),
        ...(tx.maxFeePerGas ? { maxFeePerGas: hexToBigInt(tx.maxFeePerGas) } : {}),
        ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: hexToBigInt(tx.maxPriorityFeePerGas) } : {}),
      })
      return { txHash }
    },
  }
}

export function createLocalKeySignAndTransaction(args: {
  privateKey: Hex
  rpcUrl: string
  chainId: number
  transport?: Transport
}): SignAndTransactionRunner {
  const account = privateKeyToAccount(args.privateKey)
  const sender = createLocalKeySender(args)

  return async <TPrepared>(
    req: SignAndTransactionRequest<TPrepared>,
  ): Promise<BrowserWalletSignAndTransaction<TPrepared>> => {
    const message = req.messageForAccount ? req.messageForAccount(account.address) : req.message
    if (!message) throw new Error('Local-key signer received no message to sign')
    if (req.expectedAccount && getAddress(req.expectedAccount) !== getAddress(account.address)) {
      throw new Error(
        `The stored operator key (${account.address}) is not this agent's authorized operator wallet (${getAddress(req.expectedAccount)}). ` +
          'Store the correct operator key, or authorize this wallet via `npx ethagent` -> Custody Mode.',
      )
    }
    const signature = await account.signMessage({ message })
    const next = await req.prepareTransaction({ account: account.address, message, signature })
    const { txHash } = await sender.send(next)
    return { account: account.address, message, signature, txHash, prepared: next.prepared }
  }
}
