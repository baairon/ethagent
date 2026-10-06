import { hostOf, isAbortError, learnedLogRange, noteLogRange } from './adaptive.js'

// eth_getLogs without fixed windows. Each endpoint caps how many blocks one query may
// span (mainnet.base.org: 500) and how far back it keeps logs (base.publicnode.com:
// about a day without a token). A scan starts from the range the endpoint has shown
// before, takes the limit an endpoint names in its refusal, otherwise halves on a range
// refusal, and remembers what worked in hosts.json. An endpoint that refuses the depth
// of history hands the scan to the next one.

const RANGE_RPC_CODES = new Set([-32614, -32005])
const RANGE_MESSAGE = /block range|range (?:is )?(?:too (?:large|wide)|limit|exceed)|limited to (?:a )?\d+|exceed(?:s|ed)? (?:the )?max(?:imum)?|query returned more than|too many (?:results|logs|blocks)|response size|HTTP 413|payload too large/i
const NAMED_LIMIT = /limited to (?:a )?(\d[\d,]*)|(\d[\d,]*) blocks? (?:range|max)|max(?:imum)? (?:block )?range(?: of| is|:)? (\d[\d,]*)|range (?:is )?(?:limited|capped) to (\d[\d,]*)/i
const HISTORY_MESSAGE = /histor|pruned|archive|missing trie node|older than|not available|beyond|too old|state.*not found/i

type ErrorFacts = { code?: number; text: string }

function facts(err: unknown): ErrorFacts {
  const texts: string[] = []
  let code: number | undefined
  let current: unknown = err
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const item = current as { code?: unknown; message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown }
    if (code === undefined && typeof item.code === 'number') code = item.code
    for (const part of [item.details, item.shortMessage, item.message]) {
      if (typeof part === 'string') texts.push(part)
    }
    current = item.cause
  }
  return { ...(code !== undefined ? { code } : {}), text: texts.join(' | ') }
}

export type LogQueryRefusal =
  | { kind: 'range'; limit?: number }
  | { kind: 'history' }
  | { kind: 'other' }

export function classifyLogQueryError(err: unknown): LogQueryRefusal {
  const { code, text } = facts(err)
  if ((code !== undefined && RANGE_RPC_CODES.has(code)) || RANGE_MESSAGE.test(text)) {
    const match = NAMED_LIMIT.exec(text)
    const named = match ? Number((match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').replace(/,/g, '')) : NaN
    return Number.isFinite(named) && named > 0 ? { kind: 'range', limit: named } : { kind: 'range' }
  }
  if (code === -32602 || HISTORY_MESSAGE.test(text)) return { kind: 'history' }
  return { kind: 'other' }
}

export class LogScanError extends Error {
  readonly notes: string[]
  constructor(notes: string[], cause?: unknown) {
    super(`${notes.join('; ') || 'no endpoint is configured'}; set an RPC with history (ETHAGENT_RPC_URL) and try again.`, { cause })
    this.name = 'LogScanError'
    this.notes = notes
  }
}

export type ScanLogsArgs<T> = {
  // Endpoints in the order to ask them; the scan moves on when one cannot serve it.
  urls: readonly string[]
  fromBlock: bigint
  toBlock: bigint
  // Where a host with nothing learned starts.
  initialRange: bigint
  // One eth_getLogs against one endpoint for an inclusive block span.
  query: (url: string, fromBlock: bigint, toBlock: bigint) => Promise<T[]>
  // An endpoint that would need more queries than this to cover the span is passed
  // over, since a 500-block limit would otherwise mean tens of thousands of requests.
  // Defaults to twice what the span takes at the initial range, and at least 400.
  maxQueriesPerEndpoint?: number
  signal?: AbortSignal
}

const DEFAULT_MAX_QUERIES = 400

function plural(blocks: bigint | number): string {
  return `${blocks.toString()} block${blocks.toString() === '1' ? '' : 's'}`
}

// Scans newest first and yields each span's logs as it arrives, so a caller can stop
// once it has found what it needs.
export async function* scanLogs<T>(args: ScanLogsArgs<T>): AsyncGenerator<T[]> {
  if (args.fromBlock > args.toBlock) return
  const span = args.toBlock - args.fromBlock + 1n
  const atInitial = (span + args.initialRange - 1n) / args.initialRange
  const maxQueries = args.maxQueriesPerEndpoint !== undefined
    ? BigInt(args.maxQueriesPerEndpoint)
    : (atInitial * 2n > BigInt(DEFAULT_MAX_QUERIES) ? atInitial * 2n : BigInt(DEFAULT_MAX_QUERIES))
  const notes: string[] = []
  let lastError: unknown
  let urlIndex = 0
  let end = args.toBlock

  endpoints: while (end >= args.fromBlock) {
    const url = args.urls[urlIndex]
    if (url === undefined) throw new LogScanError(notes, lastError)
    const host = hostOf(url)
    let range = BigInt(learnedLogRange(host) ?? Number(args.initialRange))
    let queries = 0n
    while (end >= args.fromBlock) {
      if (args.signal?.aborted) throw abortError()
      const remaining = end - args.fromBlock + 1n
      if (queries + (remaining + range - 1n) / range > maxQueries) {
        notes.push(`${host} serves ${plural(range)} per query, too few for ${plural(remaining)} of history`)
        urlIndex += 1
        continue endpoints
      }
      const start = end - range + 1n > args.fromBlock ? end - range + 1n : args.fromBlock
      let logs: T[]
      try {
        logs = await args.query(url, start, end)
      } catch (err: unknown) {
        if (isAbortError(err)) throw err
        lastError = err
        const refusal = classifyLogQueryError(err)
        if (refusal.kind === 'range') {
          const span = end - start + 1n
          const next = refusal.limit !== undefined && BigInt(refusal.limit) < span ? BigInt(refusal.limit) : span / 2n
          if (next < 1n) {
            notes.push(`${host} refused even a one-block query`)
            urlIndex += 1
            continue endpoints
          }
          range = next
          noteLogRange(host, Number(range))
          continue
        }
        notes.push(refusal.kind === 'history'
          ? `${host} does not keep logs back to block ${start.toString()}`
          : `${host} failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
        urlIndex += 1
        continue endpoints
      }
      queries += 1n
      if (end - start + 1n === range && learnedLogRange(host) === undefined) noteLogRange(host, Number(range))
      if (logs.length > 0) yield logs
      if (start === args.fromBlock) return
      end = start - 1n
    }
  }
}

function abortError(): Error {
  const err = new Error('The operation was cancelled.')
  err.name = 'AbortError'
  return err
}
