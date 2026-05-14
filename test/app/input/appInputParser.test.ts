import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAppInputParseState,
  parseAppInput,
} from '../../../src/app/input/appInputParser.js'

test('parseAppInput drops U+FFFD from Windows media-key noise', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, Buffer.from([0x90]))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '')
})

test('parseAppInput drops a long run of replacement chars produced by garbled bytes', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, Buffer.from([0x90, 0x91, 0x92, 0x93, 0x94]))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '')
})

test('parseAppInput preserves plain ASCII text', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, 'hello')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'hello')
})

test('parseAppInput still parses arrow-up escape sequence', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1b[A')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.key.upArrow, true)
})

test('parseAppInput maps lone carriage return to return key', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\r')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.key.return, true)
})

test('parseAppInput strips embedded controls from multi-char text but keeps printables', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, 'a\u0000b\uFFFDc')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'abc')
})

test('parseAppInput drops private-use-area chars (e.g. Windows media-key payloads)', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, 'a\uE001b\uF000c')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'abc')
})

test('parseAppInput drops zero-width format chars', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, 'x\u200Bz')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'xz')
})

test('parseAppInput preserves emoji from the supplementary plane', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\u{1F44B}')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '\u{1F44B}')
})

test('parseAppInput preserves punctuation and symbols', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, 'a!b@c#$%')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'a!b@c#$%')
})

test('parseAppInput drops a chunk made entirely of PUA chars (volume-key style payload)', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\uE0E1\uE0E2\uE0E3\uE0E4\uE0E5')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '')
})

test('Alt-fallback emits empty input for non-ASCII payload byte', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1b\u00AB')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '')
  assert.equal(events[0]?.key.meta, true)
})

test('Alt+letter still emits the letter with meta flag', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1ba')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'a')
  assert.equal(events[0]?.key.meta, true)
})

test('CSI_U with a high (non-ASCII) codepoint drops the input field', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1b[175u')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '')
})

test('CSI_U with a printable ASCII codepoint still emits the char', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1b[97u')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'a')
})

test('CSI_U with a ctrl modifier preserves the letter so Ctrl+letter shortcuts still fire', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1b[97;5u')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, 'a')
  assert.equal(events[0]?.key.ctrl, true)
})

test('CSI_U with a high codepoint AND ctrl modifier still drops input (key isnt a letter)', () => {
  const state = createAppInputParseState()
  const { events } = parseAppInput(state, '\x1b[175;5u')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.input, '')
  assert.equal(events[0]?.key.ctrl, true)
})
