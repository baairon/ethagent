import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  createAppInputParseState,
  parseAppInput,
  type AppInputEvent,
} from '../src/input/appInputParser.js'

test('parseAppInput emits one pasted event for complete bracketed paste', () => {
  const { events } = parseChunks([`${BRACKETED_PASTE_START}hello\nthere${BRACKETED_PASTE_END}`])

  assert.equal(events.length, 1)
  assert.equal(events[0]?.isPasted, true)
  assert.equal(events[0]?.input, 'hello\nthere')
})

test('parseAppInput keeps split bracketed paste markers atomic', () => {
  const { events } = parseChunks([
    '\x1b',
    '[200~alpha',
    '\nbeta',
    '\x1b[20',
    '1~',
  ])

  assert.deepEqual(events.map(event => event.input), ['alpha\nbeta'])
  assert.equal(events[0]?.isPasted, true)
})

test('parseAppInput preserves text before and after bracketed paste in order', () => {
  const { events } = parseChunks([`before ${BRACKETED_PASTE_START}paste${BRACKETED_PASTE_END} after`])

  assert.deepEqual(events.map(event => ({ input: event.input, pasted: event.isPasted })), [
    { input: 'before ', pasted: false },
    { input: 'paste', pasted: true },
    { input: ' after', pasted: false },
  ])
})

test('parseAppInput flushes a lone escape as escape instead of paste', () => {
  let state = createAppInputParseState()
  let result = parseAppInput(state, '\x1b')
  state = result.state
  assert.deepEqual(result.events, [])

  result = parseAppInput(state, null)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0]?.key.escape, true)
  assert.equal(result.events[0]?.isPasted, false)
})

test('parseAppInput parses arrows, alt keys, ctrl keys, and shift enter', () => {
  const { events } = parseChunks(['\x1b[A', '\x1bp', '\x03', '\x1b[13;2u', '\x1b[27;2;13~'])

  assert.equal(events[0]?.key.upArrow, true)
  assert.equal(events[1]?.input, 'p')
  assert.equal(events[1]?.key.meta, true)
  assert.equal(events[2]?.input, 'c')
  assert.equal(events[2]?.key.ctrl, true)
  assert.equal(events[3]?.key.return, true)
  assert.equal(events[3]?.key.shift, true)
  assert.equal(events[4]?.key.return, true)
  assert.equal(events[4]?.key.shift, true)
})

test('parseAppInput parses alt enter as a soft-break fallback', () => {
  const { events } = parseChunks(['\x1b\r'])

  assert.equal(events.length, 1)
  assert.equal(events[0]?.key.return, true)
  assert.equal(events[0]?.key.meta, true)
})

function parseChunks(chunks: string[]): { events: AppInputEvent[] } {
  let state = createAppInputParseState()
  const events: AppInputEvent[] = []

  for (const chunk of chunks) {
    const result = parseAppInput(state, chunk)
    state = result.state
    events.push(...result.events)
  }

  const flushed = parseAppInput(state, null)
  events.push(...flushed.events)
  return { events }
}
