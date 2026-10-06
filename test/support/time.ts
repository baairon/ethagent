import type { TestContext } from 'node:test'

// Lets promise callbacks run between mocked timer ticks. setImmediate stays real.
export const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

// Mocked time jumps to the end of a tick before it runs timers, so a chain of re-armed
// timers only lines up with real behavior when time moves in small steps.
export async function advance(t: TestContext, ms: number): Promise<void> {
  const step = 250
  for (let moved = 0; moved < ms; moved += step) {
    t.mock.timers.tick(Math.min(step, ms - moved))
    await flush()
  }
}

export type Tracked = { settled: boolean; error?: unknown }

// Records how a promise ends without awaiting it, so a test can look between ticks.
export function track(promise: Promise<unknown>): Tracked {
  const state: Tracked = { settled: false }
  promise.then(
    () => { state.settled = true },
    (error: unknown) => {
      state.settled = true
      state.error = error
    },
  )
  return state
}
