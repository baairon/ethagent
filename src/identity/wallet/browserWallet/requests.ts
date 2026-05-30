import { normalizeWalletPayloadPurpose } from '../walletPurposeCompat.js'
import { startBrowserWalletServer } from './requestServer.js'
import type {
  AccountRequest,
  BrowserWalletAccount,
  BrowserWalletSignAndTransaction,
  BrowserWalletSignature,
  BrowserWalletTransaction,
  SignAndTransactionRequest,
  SignatureRequest,
  TransactionRequest,
} from './types.js'
import {
  assertExpectedAccount,
  chainIdHex,
  parseAccount,
  parseHex,
  verifyRecoveredAccount,
} from './validation.js'

export async function requestBrowserWalletAccount(args: AccountRequest = {}): Promise<BrowserWalletAccount> {
  return await startBrowserWalletServer<BrowserWalletAccount>({
    title: 'ethagent wallet connection',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: normalizeWalletPayloadPurpose({
      kind: 'account',
      ...(args.purpose ? { purpose: args.purpose } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
      ...(args.tokenChainName ? { tokenChainName: args.tokenChainName } : {}),
    }),
    complete: body => {
      const account = parseAccount(body.account)
      return { account }
    },
  })
}

export async function requestBrowserWalletSignature(args: SignatureRequest): Promise<BrowserWalletSignature> {
  if (!args.message && !args.messageForAccount) throw new Error('Wallet signature request needs a message')
  return await startBrowserWalletServer<BrowserWalletSignature>({
    title: 'ethagent wallet signature',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: normalizeWalletPayloadPurpose({
      kind: 'sign',
      chainIdHex: chainIdHex(args.chainId),
      message: args.message,
      ...(args.expectedAccount ? { expectedAccount: args.expectedAccount } : {}),
      ...(args.purpose ? { purpose: args.purpose } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
      ...(args.tokenChainName ? { tokenChainName: args.tokenChainName } : {}),
    }),
    prepare: body => {
      const account = parseAccount(body.account)
      assertExpectedAccount(account, args.expectedAccount, args.purpose)
      const message = args.messageForAccount ? args.messageForAccount(account) : args.message!
      return { message }
    },
    complete: body => {
      const account = parseAccount(body.account)
      const message = typeof body.message === 'string' ? body.message : ''
      const signature = parseHex(body.signature, 'wallet signature')
      assertExpectedAccount(account, args.expectedAccount, args.purpose)
      verifyRecoveredAccount(message, signature, account)
      return { account, message, signature }
    },
  })
}

export async function sendBrowserWalletTransaction(args: TransactionRequest): Promise<BrowserWalletTransaction> {
  return await startBrowserWalletServer<BrowserWalletTransaction>({
    title: 'ethagent wallet transaction',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: normalizeWalletPayloadPurpose({
      kind: 'transaction',
      chainIdHex: chainIdHex(args.chainId),
      expectedAccount: args.expectedAccount,
      tx: {
        ...(args.to ? { to: args.to } : {}),
        data: args.data,
        ...(args.value ? { value: args.value } : {}),
        ...(args.gas ? { gas: args.gas } : {}),
        ...(args.maxFeePerGas ? { maxFeePerGas: args.maxFeePerGas } : {}),
        ...(args.maxPriorityFeePerGas ? { maxPriorityFeePerGas: args.maxPriorityFeePerGas } : {}),
      },
      ...(args.purpose ? { purpose: args.purpose } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
      ...(args.tokenChainName ? { tokenChainName: args.tokenChainName } : {}),
    }),
    complete: body => {
      const account = parseAccount(body.account)
      assertExpectedAccount(account, args.expectedAccount, args.purpose)
      return { account, txHash: parseHex(body.txHash, 'transaction hash') }
    },
  })
}

export async function requestBrowserWalletSignatureAndTransaction<TPrepared>(
  args: SignAndTransactionRequest<TPrepared>,
): Promise<BrowserWalletSignAndTransaction<TPrepared>> {
  if (!args.message && !args.messageForAccount) throw new Error('Wallet signature request needs a message')

  let prepared:
    | {
        account: `0x${string}`
        message: string
        signature: `0x${string}`
        tx: { to: `0x${string}`; data: `0x${string}`; value?: `0x${string}` }
        prepared: TPrepared
      }
    | null = null

  return await startBrowserWalletServer<BrowserWalletSignAndTransaction<TPrepared>>({
    title: 'ethagent wallet request',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: normalizeWalletPayloadPurpose({
      kind: 'sign-transaction',
      chainIdHex: chainIdHex(args.chainId),
      message: args.message,
      ...(args.expectedAccount ? { expectedAccount: args.expectedAccount } : {}),
      ...(args.purpose ? { purpose: args.purpose } : {}),
      ...(args.flowId ? { flowId: args.flowId } : {}),
      ...(typeof args.flowStep === 'number' ? { flowStep: args.flowStep } : {}),
      ...(args.tokenChainName ? { tokenChainName: args.tokenChainName } : {}),
    }),
    prepare: body => {
      const account = parseAccount(body.account)
      assertExpectedAccount(account, args.expectedAccount, args.purpose)
      const message = args.messageForAccount ? args.messageForAccount(account) : args.message!
      return { message }
    },
    prepareTransaction: async body => {
      const account = parseAccount(body.account)
      const message = typeof body.message === 'string' ? body.message : ''
      const signature = parseHex(body.signature, 'wallet signature')
      assertExpectedAccount(account, args.expectedAccount, args.purpose)
      verifyRecoveredAccount(message, signature, account)
      const next = await args.prepareTransaction({ account, message, signature })
      prepared = {
        account,
        message,
        signature,
        tx: {
          to: next.to,
          data: next.data,
          ...(next.value ? { value: next.value } : {}),
        },
        prepared: next.prepared,
      }
      return {
        tx: prepared.tx,
      }
    },
    complete: body => {
      if (!prepared) throw new Error('Wallet transaction was not prepared')
      const account = parseAccount(body.account)
      assertExpectedAccount(account, prepared.account, args.purpose)
      return {
        account,
        message: prepared.message,
        signature: prepared.signature,
        txHash: parseHex(body.txHash, 'transaction hash'),
        prepared: prepared.prepared,
      }
    },
  })
}
