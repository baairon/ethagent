import { BACKOFF_CEILING_MS, DefinitiveError, isAbortError, sleep } from './adaptive.js'

// What one look at the chain found. `pending` means the answer is not visible yet (a
// follower behind the block that carries the change, an empty read of fresh code), so
// the look is repeated on a later block. `done` ends the wait with the value.
export type PacedLook<T> = { done: true; value: T } | { done: false; observed?: string }

export type PacedOptions = {
  // The chain's block time: the first pause, so a retry lands on a new block.
  blockTimeMs: number
  // Before the first look, wait until the endpoint's head reaches this block, so a
  // read at latest can see what the receipt recorded.
  minBlock?: { block: bigint; getBlockNumber: () => Promise<bigint> }
  signal?: AbortSignal
  // Test seam: how a pause is spent.
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>
  // The largest single pause. Defaults to the adaptive backoff ceiling.
  ceilingMs?: number
}

export class PacedTimeoutError extends Error {
  readonly observed: string | undefined
  constructor(label: string, observed: string | undefined, waitedMs: number) {
    super(`${label} was still not visible after ${Math.round(waitedMs / 1000)} seconds of new blocks${observed ? ` (last seen: ${observed})` : ''}.`)
    this.name = 'PacedTimeoutError'
    this.observed = observed
  }
}

// A revert, a rejected signature, or an empty balance reads the same from every block,
// so waiting never changes it.
export function isDefinitiveChainError(err: unknown): boolean {
  if (err instanceof DefinitiveError) return true
  let current: unknown = err
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const item = current as { name?: unknown; code?: unknown; message?: unknown; shortMessage?: unknown; cause?: unknown }
    const name = typeof item.name === 'string' ? item.name : ''
    if (/^(ExecutionRevertedError|ContractFunctionRevertedError|InsufficientFundsError|UserRejectedRequestError)$/.test(name)) return true
    if (item.code === 3 || item.code === 4001) return true
    const text = `${typeof item.shortMessage === 'string' ? item.shortMessage : ''} ${typeof item.message === 'string' ? item.message : ''}`
    if (/execution reverted|insufficient funds|reverted with/i.test(text)) return true
    current = item.cause
  }
  return false
}

// Looks at the chain once per new block until the answer is visible. Pauses start at
// the block time and double, and the wait gives up once the next pause would pass the
// backoff ceiling. A definitive answer (a thrown revert, or a look that throws
// DefinitiveError) ends it at once; other throws count as "not visible yet", and the
// last one is what surfaces when the wait gives up.
export async function pacedConfirm<T>(
  label: string,
  look: () => Promise<PacedLook<T>>,
  options: PacedOptions,
): Promise<T> {
  const pause = options.pause ?? sleep
  const ceiling = options.ceilingMs ?? BACKOFF_CEILING_MS
  const floor = Math.max(1, options.blockTimeMs)
  let delay = 0
  let waited = 0
  let lastError: unknown
  let observed: string | undefined
  let headReached = !options.minBlock

  for (;;) {
    if (options.signal?.aborted) throw abortFrom(options.signal)
    if (delay > 0) {
      await pause(delay, options.signal)
      waited += delay
    }
    try {
      if (!headReached && options.minBlock) {
        const head = await options.minBlock.getBlockNumber()
        if (head >= options.minBlock.block) {
          headReached = true
        } else {
          observed = `endpoint head ${head.toString()}, waiting for block ${options.minBlock.block.toString()}`
        }
      }
      if (headReached) {
        const result = await look()
        if (result.done) return result.value
        lastError = undefined
        if (result.observed !== undefined) observed = result.observed
      }
    } catch (err: unknown) {
      if (isAbortError(err)) throw err
      if (err instanceof DefinitiveError) throw err.inner
      if (isDefinitiveChainError(err)) throw err
      lastError = err
    }
    const next = delay === 0 ? floor : delay * 2
    if (next > ceiling) {
      if (lastError) throw lastError
      throw new PacedTimeoutError(label, observed, waited)
    }
    delay = next
  }
}

function abortFrom(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const err = new Error('The operation was cancelled.')
  err.name = 'AbortError'
  return err
}

// The chain answered, as opposed to nobody answering: a revert, or no data from an
// address that has no such function. Callers treat these as facts about the contract.
export function isChainAnswer(err: unknown): boolean {
  if (isDefinitiveChainError(err)) return true
  let current: unknown = err
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const name = (current as { name?: unknown }).name
    if (name === 'ContractFunctionZeroDataError' || name === 'AbiDecodingZeroDataError') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}
