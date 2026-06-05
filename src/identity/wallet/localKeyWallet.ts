import { createWalletClient, getAddress, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainForId } from '../registry/erc8004/chains.js'
import type {
  BrowserWalletSignAndTransaction,
  SignAndTransactionRequest,
} from './browserWallet.js'

export type SignAndTransactionRunner = <TPrepared>(
  req: SignAndTransactionRequest<TPrepared>,
) => Promise<BrowserWalletSignAndTransaction<TPrepared>>

export function createLocalKeySignAndTransaction(args: {
  privateKey: Hex
  rpcUrl: string
  chainId: number
}): SignAndTransactionRunner {
  const account = privateKeyToAccount(args.privateKey)
  const chain = chainForId(args.chainId)
  if (!chain) throw new Error(`Unsupported chain id ${args.chainId} for local-key signing`)
  const walletClient = createWalletClient({ account, chain, transport: http(args.rpcUrl) })

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
    const txHash = await walletClient.sendTransaction({
      to: next.to,
      data: next.data,
      ...(next.value ? { value: BigInt(next.value) } : {}),
    })
    return { account: account.address, message, signature, txHash, prepared: next.prepared }
  }
}
