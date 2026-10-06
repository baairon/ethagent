import { custom, type Transport } from 'viem'
import {
  adaptiveFetch,
  createRace,
  DefinitiveError,
  failureWords,
  hostOf,
  isFailing,
  RaceError,
  rankUrls,
  type FetchLike,
} from './adaptive.js'

type JsonRpcError = { code?: number; message?: string; data?: unknown }
type RpcError = Error & { code?: number; data?: unknown }

// The chain's own verdict on the request: a revert or a rejected transaction reads the
// same from every endpoint, so the race stops on it.
const VERDICT_RPC_CODES = new Set([3, -32003, 4001, 5000])
const VERDICT_MESSAGE = /execution reverted|gas required exceeds allowance/i

// An endpoint saying it cannot serve right now, as opposed to one that judged the
// request. Size limits ("query returned more than 10000 results") are deliberately
// not here: waiting never fixes those, and the caller narrows the request instead.
const BUSY_MESSAGE = /rate.?limit|too many requests|requests? per (second|minute)|throttl|capacity|overloaded|temporarily unavailable|try again|header not found|unknown block|block not found|not yet available/i
const BUSY_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504])

// A broadcast must reach exactly one endpoint: a second copy answers "already known"
// and would look like a failure for a transaction that was accepted.
const BROADCAST_METHODS = new Set(['eth_sendRawTransaction', 'eth_sendTransaction'])

function isVerdict(error: JsonRpcError): boolean {
  return (typeof error.code === 'number' && VERDICT_RPC_CODES.has(error.code)) || VERDICT_MESSAGE.test(error.message ?? '')
}

function isBusy(error: JsonRpcError): boolean {
  return error.code === 429 || BUSY_MESSAGE.test(error.message ?? '')
}

function toRpcError(error: JsonRpcError): RpcError {
  return Object.assign(new Error(error.message ?? 'RPC error'), {
    ...(typeof error.code === 'number' ? { code: error.code } : {}),
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

// One endpoint's failure to produce a result. `busy` asks the race to come back to it,
// and `rpc` keeps the endpoint's own JSON-RPC error for when no endpoint does better.
class RpcEndpointError extends Error {
  readonly words: string
  readonly busy: boolean
  readonly rpc?: RpcError
  constructor(host: string, words: string, options: { busy?: boolean; rpc?: RpcError } = {}) {
    super(`${host}: ${words}`)
    this.name = 'RpcEndpointError'
    this.words = words
    this.busy = options.busy ?? false
    if (options.rpc) this.rpc = options.rpc
  }
}

export class RpcUnansweredError extends Error {
  readonly outcomes: Array<{ host: string; outcome: string }>
  constructor(outcomes: Array<{ host: string; outcome: string }>) {
    super(`No RPC endpoint answered (${outcomes.map(item => `${item.host}: ${item.outcome}`).join('; ') || 'none is configured'}).`)
    this.name = 'RpcUnansweredError'
    this.outcomes = outcomes
  }
}

// The first URL is the one the user or the chain config chose, so it stays first while
// it is reachable. The fallbacks behind it are ordered by what they have shown.
function askingOrder(urls: readonly string[]): string[] {
  const ranked = rankUrls(urls)
  const primary = urls[0]
  if (primary === undefined || isFailing(hostOf(primary))) return ranked
  return [primary, ...ranked.filter(url => url !== primary)]
}

function httpWords(status: number): string {
  if (status === 429) return 'rate limited'
  if (status === 401 || status === 403) return 'refused the request'
  if (status >= 500) return 'server error'
  return `HTTP ${status}`
}

export function adaptiveRpcTransport(urls: readonly string[], fetchImpl: FetchLike = adaptiveFetch): Transport {
  let id = 0
  const ask = async (url: string, body: string, signal?: AbortSignal): Promise<unknown> => {
    const host = hostOf(url)
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body,
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new RpcEndpointError(host, httpWords(response.status), { busy: BUSY_HTTP_STATUS.has(response.status) })
    }
    const text = await response.text()
    let payload: { result?: unknown; error?: JsonRpcError } | null
    try {
      payload = JSON.parse(text) as { result?: unknown; error?: JsonRpcError } | null
    } catch {
      payload = null
    }
    if (!payload || typeof payload !== 'object' || (!('result' in payload) && !payload.error)) {
      throw new RpcEndpointError(host, 'sent an unreadable reply')
    }
    if (payload.error) {
      const rpc = toRpcError(payload.error)
      if (isVerdict(payload.error)) throw new DefinitiveError(rpc)
      throw new RpcEndpointError(host, payload.error.message ?? 'RPC error', { busy: isBusy(payload.error), rpc })
    }
    return payload.result
  }

  // When no endpoint produced a result, an endpoint's own JSON-RPC error says more than
  // "nobody answered", so it is the one reported.
  const unanswered = (failures: Array<{ host: string; error: unknown }>): Error => {
    for (const failure of failures) {
      if (failure.error instanceof RpcEndpointError && failure.error.rpc) return failure.error.rpc
    }
    return new RpcUnansweredError(failures.map(failure => ({ host: failure.host, outcome: failureWords(failure.error) })))
  }

  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      id += 1
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? [] })
      const ranked = askingOrder(urls)
      if (BROADCAST_METHODS.has(method)) {
        const url = ranked[0]
        if (!url) throw new RpcUnansweredError([])
        try {
          return await ask(url, body)
        } catch (err: unknown) {
          if (err instanceof DefinitiveError) throw err.inner
          throw unanswered([{ host: hostOf(url), error: err }])
        }
      }
      const race = createRace<unknown>()
      for (const url of ranked) {
        race.add({ host: hostOf(url), run: signal => ask(url, body, signal) })
      }
      race.close()
      try {
        return await race.result
      } catch (err: unknown) {
        if (err instanceof RaceError) throw unanswered(err.failures)
        throw err
      }
    },
  }, { retryCount: 0 })
}
