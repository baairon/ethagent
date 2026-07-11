import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { normalizeWalletPayloadPurpose } from '../walletPurposeCompat.js'
import { walletPage } from './html.js'
import { isAllowedWalletOrigin, readJson, respondHtml, respondJson } from './http.js'

const SSE_DRAIN_MS = 250
import {
  BrowserWalletError,
  type BrowserWalletSession,
  type BrowserWalletSignAndTransaction,
  type BrowserWalletSignature,
  type BrowserWalletTransaction,
  type PendingPrompt,
  type ReadyHandler,
  type SignAndTransactionRequest,
} from './types.js'
import {
  assertExpectedAccount,
  chainIdHex,
  parseAccount,
  parseBrowserWalletErrorBody,
  parseHex,
  verifyRecoveredAccount,
} from './validation.js'

export async function openBrowserWalletSession(args: {
  title?: string
  onReady?: ReadyHandler
} = {}): Promise<BrowserWalletSession> {
  const title = args.title ?? 'ethagent wallet session'
  const sseClients: Set<http.ServerResponse> = new Set()
  let pending: PendingPrompt | null = null
  let closed = false

  const pushEvent = (kind: string, data: Record<string, unknown>): void => {
    const payload = `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`
    const dead: http.ServerResponse[] = []
    for (const res of sseClients) {
      try { res.write(payload) } catch { dead.push(res) }
    }
    for (const res of dead) sseClients.delete(res)
  }

  const failPending = (err: unknown): void => {
    if (!pending) return
    clearTimeout(pending.timeout)
    pending.reject(err instanceof Error ? err : new Error(String(err)))
    pending = null
  }

  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!isAllowedWalletOrigin(req)) {
      respondJson(res, 403, { ok: false, error: 'forbidden origin' })
      return
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/ethagent')) {
      respondHtml(res, walletPage(title, '', { kind: 'session-wait' }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'connection': 'keep-alive',
      })
      res.write(`: connected\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      if (pending) {
        res.write(`event: prompt\ndata: ${JSON.stringify({ sessionToken: pending.sessionToken, ...pending.payload })}\n\n`)
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/prepare') {
      const body = await readJson(req)
      if (!pending || body.sessionToken !== pending.sessionToken) {
        respondJson(res, 409, { ok: false, error: 'no active prompt' })
        return
      }
      if (!pending.prepare) {
        respondJson(res, 400, { ok: false, error: 'this prompt does not have a prepare step' })
        return
      }
      respondJson(res, 200, { ok: true, ...pending.prepare(body) })
      return
    }
    if (req.method === 'POST' && url.pathname === '/prepare-transaction') {
      const body = await readJson(req)
      if (!pending || body.sessionToken !== pending.sessionToken) {
        respondJson(res, 409, { ok: false, error: 'no active prompt' })
        return
      }
      if (!pending.prepareTransaction) {
        respondJson(res, 400, { ok: false, error: 'this prompt does not prepare transactions' })
        return
      }
      respondJson(res, 200, { ok: true, ...(await pending.prepareTransaction(body)) })
      return
    }
    if (req.method === 'POST' && url.pathname === '/complete') {
      const body = await readJson(req)
      if (!pending || body.sessionToken !== pending.sessionToken) {
        respondJson(res, 409, { ok: false, error: 'no active prompt' })
        return
      }
      const finished = pending
      try {
        finished.resolve(body)
      } catch (err) {
        respondJson(res, 400, { ok: false, error: (err as Error).message })
        return
      }
      pending = null
      clearTimeout(finished.timeout)
      respondJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/cancel') {
      const body = await readJson(req)
      if (pending && body.sessionToken === pending.sessionToken) {
        respondJson(res, 200, { ok: true })
        failPending(new Error('wallet request was cancelled'))
        return
      }
      respondJson(res, 409, { ok: false, error: 'no active prompt' })
      return
    }
    if (req.method === 'POST' && url.pathname === '/error') {
      const body = await readJson(req)
      if (pending && body.sessionToken === pending.sessionToken) {
        respondJson(res, 200, { ok: true })
        failPending(new BrowserWalletError(parseBrowserWalletErrorBody(body)))
        return
      }
      respondJson(res, 409, { ok: false, error: 'no active prompt' })
      return
    }
    respondJson(res, 404, { ok: false, error: 'wallet session not found' })
  }

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch(err => {
      if (!res.headersSent) respondJson(res, 500, { ok: false, error: (err as Error).message })
    })
  })

  const url = await new Promise<string>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('could not start wallet server'))
        return
      }
      resolve(`http://localhost:${addr.port}/`)
    })
  })
  args.onReady?.({ url })

  const dispatch = <T>(opts: {
    payload: Record<string, unknown>
    prepare?: (body: Record<string, unknown>) => Record<string, unknown>
    prepareTransaction?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
    complete: (body: Record<string, unknown>) => T
    timeoutMs?: number
  }): Promise<T> => {
    if (closed) return Promise.reject(new Error('wallet session is closed'))
    if (pending) return Promise.reject(new Error('wallet session has another prompt in flight'))
    const sessionToken = randomUUID()
    const payload = normalizeWalletPayloadPurpose(opts.payload)
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        failPending(new Error('Wallet Request Timed Out'))
      }, opts.timeoutMs ?? 5 * 60_000)
      pending = {
        sessionToken,
        payload,
        ...(opts.prepare ? { prepare: opts.prepare } : {}),
        ...(opts.prepareTransaction ? { prepareTransaction: opts.prepareTransaction } : {}),
        resolve: body => {
          resolve(opts.complete(body))
        },
        reject,
        timeout,
      }
      pushEvent('prompt', { sessionToken, ...payload })
    })
  }

  return {
    url,
    requestSignature: async (req): Promise<BrowserWalletSignature> => {
      if (!req.message && !req.messageForAccount) throw new Error('Wallet signature request needs a message')
      return dispatch<BrowserWalletSignature>({
        payload: {
          kind: 'sign',
          chainIdHex: chainIdHex(req.chainId),
          message: req.message,
          ...(req.expectedAccount ? { expectedAccount: req.expectedAccount } : {}),
          ...(req.purpose ? { purpose: req.purpose } : {}),
          ...(req.flowId ? { flowId: req.flowId } : {}),
          ...(typeof req.flowStep === 'number' ? { flowStep: req.flowStep } : {}),
          ...(req.tokenChainName ? { tokenChainName: req.tokenChainName } : {}),
        },
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
        prepare: body => {
          const account = parseAccount(body.account)
          assertExpectedAccount(account, req.expectedAccount, req.purpose)
          const message = req.messageForAccount ? req.messageForAccount(account) : req.message!
          return { message }
        },
        complete: body => {
          const account = parseAccount(body.account)
          const message = typeof body.message === 'string' ? body.message : ''
          const signature = parseHex(body.signature, 'wallet signature')
          assertExpectedAccount(account, req.expectedAccount, req.purpose)
          verifyRecoveredAccount(message, signature, account)
          return { account, message, signature }
        },
      })
    },
    sendTransaction: async (req): Promise<BrowserWalletTransaction> => dispatch<BrowserWalletTransaction>({
      payload: {
        kind: 'transaction',
        chainIdHex: chainIdHex(req.chainId),
        expectedAccount: req.expectedAccount,
        tx: { to: req.to, data: req.data, ...(req.value ? { value: req.value } : {}) },
        ...(req.purpose ? { purpose: req.purpose } : {}),
        ...(req.flowId ? { flowId: req.flowId } : {}),
        ...(typeof req.flowStep === 'number' ? { flowStep: req.flowStep } : {}),
        ...(req.tokenChainName ? { tokenChainName: req.tokenChainName } : {}),
      },
      ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
      complete: body => {
        const account = parseAccount(body.account)
        assertExpectedAccount(account, req.expectedAccount, req.purpose)
        return { account, txHash: parseHex(body.txHash, 'transaction hash') }
      },
    }),
    requestSignatureAndTransaction: async <TPrepared>(
      req: SignAndTransactionRequest<TPrepared>,
    ): Promise<BrowserWalletSignAndTransaction<TPrepared>> => {
      if (!req.message && !req.messageForAccount) throw new Error('Wallet signature request needs a message')
      let prepared:
        | {
            account: `0x${string}`
            message: string
            signature: `0x${string}`
            tx: { to: `0x${string}`; data: `0x${string}`; value?: `0x${string}` }
            prepared: TPrepared
          }
        | null = null
      return dispatch<BrowserWalletSignAndTransaction<TPrepared>>({
        payload: {
          kind: 'sign-transaction',
          chainIdHex: chainIdHex(req.chainId),
          message: req.message,
          ...(req.expectedAccount ? { expectedAccount: req.expectedAccount } : {}),
          ...(req.purpose ? { purpose: req.purpose } : {}),
          ...(req.flowId ? { flowId: req.flowId } : {}),
          ...(typeof req.flowStep === 'number' ? { flowStep: req.flowStep } : {}),
          ...(req.tokenChainName ? { tokenChainName: req.tokenChainName } : {}),
        },
        ...(req.timeoutMs !== undefined ? { timeoutMs: req.timeoutMs } : {}),
        prepare: body => {
          const account = parseAccount(body.account)
          assertExpectedAccount(account, req.expectedAccount, req.purpose)
          const message = req.messageForAccount ? req.messageForAccount(account) : req.message!
          return { message }
        },
        prepareTransaction: async body => {
          const account = parseAccount(body.account)
          const message = typeof body.message === 'string' ? body.message : ''
          const signature = parseHex(body.signature, 'wallet signature')
          assertExpectedAccount(account, req.expectedAccount, req.purpose)
          verifyRecoveredAccount(message, signature, account)
          const next = await req.prepareTransaction({ account, message, signature })
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
          return { tx: prepared.tx }
        },
        complete: body => {
          if (!prepared) throw new Error('Wallet transaction was not prepared')
          const account = parseAccount(body.account)
          assertExpectedAccount(account, prepared.account, req.purpose)
          return {
            account,
            message: prepared.message,
            signature: prepared.signature,
            txHash: parseHex(body.txHash, 'transaction hash'),
            prepared: prepared.prepared,
          }
        },
      })
    },
    close: async (): Promise<void> => {
      if (closed) return
      closed = true
      if (pending) failPending(new Error('wallet session closed before request completed'))
      pushEvent('done', {})
      await new Promise(resolve => setTimeout(resolve, SSE_DRAIN_MS))
      for (const res of sseClients) {
        try { res.end() } catch { }
      }
      sseClients.clear()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
