import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { walletPage } from './html.js'
import { readJson, respondHtml, respondJson } from './http.js'
import { BrowserWalletError, type ReadyHandler } from './types.js'
import {
  assertSessionToken,
  parseBrowserWalletErrorBody,
} from './validation.js'

export function startBrowserWalletServer<T>(args: {
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
      fail(new Error('Wallet Request Timed Out'))
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
        fail(new Error('wallet request was cancelled'))
        return
      }
      if (req.method === 'POST' && (url.pathname === '/error' || url.pathname === '/ethagent/error')) {
        const body = await readJson(req)
        assertSessionToken(body, sessionToken)
        respondJson(res, 200, { ok: true })
        fail(new BrowserWalletError(parseBrowserWalletErrorBody(body)))
        return
      }
      respondJson(res, 404, { ok: false, error: 'wallet session not found' })
    }

    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        fail(new Error('could not start wallet server'))
        return
      }
      const url = `http://localhost:${address.port}/`
      args.onReady?.({ url })
    })
  })
}
