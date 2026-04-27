import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress, type Address, type Hex } from 'viem'
import { recoverAddressFromSignature } from './eth.js'

const WALLET_PAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'wallet-page')
const WALLET_HTML = loadWalletHtml()

type ReadyHandler = (session: BrowserWalletReady) => void

export type BrowserWalletReady = {
  url: string
}

type SignatureRequest = {
  chainId: number
  expectedAccount?: Address
  message?: string
  messageForAccount?: (account: Address) => string
  timeoutMs?: number
  onReady?: ReadyHandler
}

type TransactionRequest = {
  chainId: number
  expectedAccount: Address
  to: Address
  data: Hex
  value?: Hex
  timeoutMs?: number
  onReady?: ReadyHandler
}

type SignAndTransactionRequest<TPrepared> = {
  chainId: number
  expectedAccount?: Address
  message?: string
  messageForAccount?: (account: Address) => string
  timeoutMs?: number
  onReady?: ReadyHandler
  prepareTransaction: (wallet: BrowserWalletSignature) => Promise<{
    to: Address
    data: Hex
    value?: Hex
    prepared: TPrepared
  }>
}

type AccountRequest = {
  timeoutMs?: number
  onReady?: ReadyHandler
}

export type BrowserWalletSignature = {
  account: Address
  message: string
  signature: Hex
}

export type BrowserWalletTransaction = {
  account: Address
  txHash: Hex
}

export type BrowserWalletSignAndTransaction<TPrepared> = BrowserWalletSignature & {
  txHash: Hex
  prepared: TPrepared
}

export type BrowserWalletAccount = {
  account: Address
}

export async function requestBrowserWalletAccount(args: AccountRequest = {}): Promise<BrowserWalletAccount> {
  return await startBrowserWalletServer<BrowserWalletAccount>({
    title: 'ethagent wallet connection',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: {
      kind: 'account',
    },
    complete: body => {
      const account = parseAccount(body.account)
      return { account }
    },
  })
}

export async function requestBrowserWalletSignature(args: SignatureRequest): Promise<BrowserWalletSignature> {
  if (!args.message && !args.messageForAccount) throw new Error('wallet signature request needs a message')
  return await startBrowserWalletServer<BrowserWalletSignature>({
    title: 'ethagent wallet signature',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: {
      kind: 'sign',
      chainIdHex: chainIdHex(args.chainId),
      message: args.message,
    },
    prepare: body => {
      const account = parseAccount(body.account)
      if (args.expectedAccount && account.toLowerCase() !== args.expectedAccount.toLowerCase()) {
        throw new Error(`connected wallet ${account} does not match owner ${args.expectedAccount}`)
      }
      const message = args.messageForAccount ? args.messageForAccount(account) : args.message!
      return { message }
    },
    complete: body => {
      const account = parseAccount(body.account)
      const message = typeof body.message === 'string' ? body.message : ''
      const signature = parseHex(body.signature, 'wallet signature')
      if (args.expectedAccount && account.toLowerCase() !== args.expectedAccount.toLowerCase()) {
        throw new Error(`connected wallet ${account} does not match owner ${args.expectedAccount}`)
      }
      const recovered = recoverAddressFromSignature(message, signature)
      if (recovered.toLowerCase() !== account.toLowerCase()) {
        throw new Error('wallet signature does not match connected account')
      }
      return { account, message, signature }
    },
  })
}

export async function sendBrowserWalletTransaction(args: TransactionRequest): Promise<BrowserWalletTransaction> {
  return await startBrowserWalletServer<BrowserWalletTransaction>({
    title: 'ethagent wallet transaction',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: {
      kind: 'transaction',
      chainIdHex: chainIdHex(args.chainId),
      expectedAccount: args.expectedAccount,
      tx: {
        to: args.to,
        data: args.data,
        ...(args.value ? { value: args.value } : {}),
      },
    },
    complete: body => {
      const account = parseAccount(body.account)
      if (account.toLowerCase() !== args.expectedAccount.toLowerCase()) {
        throw new Error(`connected wallet ${account} does not match owner ${args.expectedAccount}`)
      }
      return { account, txHash: parseHex(body.txHash, 'transaction hash') }
    },
  })
}

export async function requestBrowserWalletSignatureAndTransaction<TPrepared>(
  args: SignAndTransactionRequest<TPrepared>,
): Promise<BrowserWalletSignAndTransaction<TPrepared>> {
  if (!args.message && !args.messageForAccount) throw new Error('wallet signature request needs a message')

  let prepared:
    | {
        account: Address
        message: string
        signature: Hex
        tx: { to: Address; data: Hex; value?: Hex }
        prepared: TPrepared
      }
    | null = null

  return await startBrowserWalletServer<BrowserWalletSignAndTransaction<TPrepared>>({
    title: 'ethagent wallet approval',
    timeoutMs: args.timeoutMs,
    onReady: args.onReady,
    payload: {
      kind: 'sign-transaction',
      chainIdHex: chainIdHex(args.chainId),
      message: args.message,
    },
    prepare: body => {
      const account = parseAccount(body.account)
      if (args.expectedAccount && account.toLowerCase() !== args.expectedAccount.toLowerCase()) {
        throw new Error(`connected wallet ${account} does not match owner ${args.expectedAccount}`)
      }
      const message = args.messageForAccount ? args.messageForAccount(account) : args.message!
      return { message }
    },
    prepareTransaction: async body => {
      const account = parseAccount(body.account)
      const message = typeof body.message === 'string' ? body.message : ''
      const signature = parseHex(body.signature, 'wallet signature')
      if (args.expectedAccount && account.toLowerCase() !== args.expectedAccount.toLowerCase()) {
        throw new Error(`connected wallet ${account} does not match owner ${args.expectedAccount}`)
      }
      const recovered = recoverAddressFromSignature(message, signature)
      if (recovered.toLowerCase() !== account.toLowerCase()) {
        throw new Error('wallet signature does not match connected account')
      }
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
      if (!prepared) throw new Error('wallet transaction was not prepared')
      const account = parseAccount(body.account)
      if (account.toLowerCase() !== prepared.account.toLowerCase()) {
        throw new Error(`connected wallet ${account} does not match owner ${prepared.account}`)
      }
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

function startBrowserWalletServer<T>(args: {
  title: string
  payload: Record<string, unknown>
  timeoutMs?: number
  onReady?: ReadyHandler
  prepare?: (body: Record<string, unknown>) => Record<string, unknown>
  prepareTransaction?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  complete: (body: Record<string, unknown>) => T
}): Promise<T> {
  const sessionToken = randomUUID()
  const timeoutMs = args.timeoutMs ?? 5 * 60_000

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      fn()
    }
    const fail = (err: unknown): void => finish(() => reject(err instanceof Error ? err : new Error(String(err))))

    const server = http.createServer((req, res) => {
      void handleRequest(req, res).catch(err => {
        respondJson(res, 500, { ok: false, error: (err as Error).message })
      })
    })

    const timer = setTimeout(() => {
      fail(new Error('browser wallet request timed out'))
    }, timeoutMs)

    const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/ethagent')) {
        respondHtml(res, walletPage(args.title, sessionToken, args.payload))
        return
      }
      if (req.method === 'POST' && (url.pathname === '/prepare' || url.pathname === '/ethagent/prepare')) {
        const body = await readJson(req)
        assertSessionToken(body, sessionToken)
        if (!args.prepare) {
          respondJson(res, 400, { ok: false, error: 'this wallet request does not have a prepare step' })
          return
        }
        respondJson(res, 200, { ok: true, ...args.prepare(body) })
        return
      }
      if (req.method === 'POST' && (url.pathname === '/prepare-transaction' || url.pathname === '/ethagent/prepare-transaction')) {
        const body = await readJson(req)
        assertSessionToken(body, sessionToken)
        if (!args.prepareTransaction) {
          respondJson(res, 400, { ok: false, error: 'this wallet request does not prepare transactions' })
          return
        }
        respondJson(res, 200, { ok: true, ...(await args.prepareTransaction(body)) })
        return
      }
      if (req.method === 'POST' && (url.pathname === '/complete' || url.pathname === '/ethagent/complete')) {
        const body = await readJson(req)
        assertSessionToken(body, sessionToken)
        const result = args.complete(body)
        respondJson(res, 200, { ok: true })
        finish(() => resolve(result))
        return
      }
      if (req.method === 'POST' && (url.pathname === '/cancel' || url.pathname === '/ethagent/cancel')) {
        const body = await readJson(req)
        assertSessionToken(body, sessionToken)
        respondJson(res, 200, { ok: true })
        fail(new Error('browser wallet request was cancelled'))
        return
      }
      respondJson(res, 404, { ok: false, error: 'wallet session not found' })
    }

    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        fail(new Error('could not start browser wallet server'))
        return
      }
      const url = `http://localhost:${address.port}/`
      args.onReady?.({ url })
    })
  })
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = raw ? JSON.parse(raw) as unknown : {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request body must be a JSON object')
  return parsed as Record<string, unknown>
}

function respondHtml(res: http.ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function respondJson(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function parseAccount(value: unknown): Address {
  if (typeof value !== 'string') throw new Error('wallet account is missing')
  return getAddress(value)
}

function parseHex(value: unknown, label: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`${label} is invalid`)
  return value as Hex
}

function assertSessionToken(body: Record<string, unknown>, sessionToken: string): void {
  if (body.sessionToken !== sessionToken) throw new Error('wallet session token is invalid')
}

function chainIdHex(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex
}

function loadWalletHtml(): string {
  try {
    return readFileSync(join(WALLET_PAGE_DIR, 'wallet.html'), 'utf8')
  } catch (err) {
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'identity', 'wallet-page', 'wallet.html')
    try {
      return readFileSync(sourcePath, 'utf8')
    } catch {
      throw err
    }
  }
}

export function __testWalletPage(title: string, sessionToken: string, payload: Record<string, unknown>): string {
  return walletPage(title, sessionToken, payload)
}

function walletPage(title: string, sessionToken: string, payload: Record<string, unknown>): string {
  const config = JSON.stringify({ sessionToken, ...payload }).replaceAll('<', '\\u003c')
  const injection = `<script>window.__WALLET_CONFIG__ = ${config};</script>`
  return WALLET_HTML
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('<head>', `<head>\n  ${injection}`)
}
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
