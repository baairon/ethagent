import type { Key } from 'ink'

export const BRACKETED_PASTE_ENABLE = '\x1b[?2004h'
export const BRACKETED_PASTE_DISABLE = '\x1b[?2004l'
export const BRACKETED_PASTE_START = '\x1b[200~'
export const BRACKETED_PASTE_END = '\x1b[201~'
export const ENABLE_KITTY_KEYBOARD = '\x1b[>1u'
export const DISABLE_KITTY_KEYBOARD = '\x1b[<u'
export const ENABLE_MODIFY_OTHER_KEYS = '\x1b[>4;2m'
export const DISABLE_MODIFY_OTHER_KEYS = '\x1b[>4m'

export type AppInputEvent = {
  input: string
  key: Key
  isPasted: boolean
  raw: string
}

export type AppInputParseState = {
  mode: 'normal' | 'paste'
  pending: string
  pasteBuffer: string
}

type ParseResult = {
  events: AppInputEvent[]
  state: AppInputParseState
}

const ESC = '\x1b'
const CSI_U_RE = /^\x1b\[(\d+)(?:;(\d+))?u/
const MODIFY_OTHER_KEYS_RE = /^\x1b\[27;(\d+);(\d+)~/

const KNOWN_SEQUENCES: Array<{ sequence: string; key: Partial<Key> }> = [
  { sequence: '\x1b[A', key: { upArrow: true } },
  { sequence: '\x1b[B', key: { downArrow: true } },
  { sequence: '\x1b[C', key: { rightArrow: true } },
  { sequence: '\x1b[D', key: { leftArrow: true } },
  { sequence: '\x1b[Z', key: { tab: true, shift: true } },
  { sequence: '\x1b[3~', key: { delete: true } },
  { sequence: '\x1b[5~', key: { pageUp: true } },
  { sequence: '\x1b[6~', key: { pageDown: true } },
  { sequence: '\x1b[H', key: { home: true } },
  { sequence: '\x1b[F', key: { end: true } },
]

const PENDING_PREFIXES = [
  BRACKETED_PASTE_START,
  BRACKETED_PASTE_END,
  ...KNOWN_SEQUENCES.map(entry => entry.sequence),
  '\x1b[13;2u',
  '\x1b[27;2;13~',
]

export function createAppInputParseState(): AppInputParseState {
  return { mode: 'normal', pending: '', pasteBuffer: '' }
}

export function hasPendingAppInput(state: AppInputParseState): boolean {
  return state.pending.length > 0
}

export function parseAppInput(
  previous: AppInputParseState,
  chunk: Buffer | string | null,
): ParseResult {
  const source = previous.pending + (chunk === null ? '' : stringifyChunk(chunk))
  const events: AppInputEvent[] = []
  const state: AppInputParseState = {
    mode: previous.mode,
    pending: '',
    pasteBuffer: previous.pasteBuffer,
  }

  let rest = source
  while (rest.length > 0) {
    if (state.mode === 'paste') {
      const endIndex = rest.indexOf(BRACKETED_PASTE_END)
      if (endIndex === -1) {
        const pending = chunk === null ? '' : longestSuffixPrefix(rest, [BRACKETED_PASTE_END])
        state.pasteBuffer += rest.slice(0, rest.length - pending.length)
        state.pending = pending
        rest = ''
        break
      }

      state.pasteBuffer += rest.slice(0, endIndex)
      events.push(createInputEvent(state.pasteBuffer, {}, state.pasteBuffer, true))
      state.mode = 'normal'
      state.pasteBuffer = ''
      rest = rest.slice(endIndex + BRACKETED_PASTE_END.length)
      continue
    }

    if (rest.startsWith(BRACKETED_PASTE_START)) {
      state.mode = 'paste'
      state.pasteBuffer = ''
      rest = rest.slice(BRACKETED_PASTE_START.length)
      continue
    }

    if (rest.startsWith(BRACKETED_PASTE_END)) {
      rest = rest.slice(BRACKETED_PASTE_END.length)
      continue
    }

    const parsed = parseNormalInput(rest, chunk === null)
    if (parsed.kind === 'pending') {
      state.pending = parsed.pending
      rest = ''
      break
    }
    events.push(parsed.event)
    rest = rest.slice(parsed.length)
  }

  return { events, state }
}

type NormalParseResult =
  | { kind: 'event'; event: AppInputEvent; length: number }
  | { kind: 'pending'; pending: string }

function parseNormalInput(source: string, flushing: boolean): NormalParseResult {
  if (!source.startsWith(ESC)) {
    const nextEscape = source.indexOf(ESC)
    const text = nextEscape === -1 ? source : source.slice(0, nextEscape)
    return { kind: 'event', event: createTextEvent(text), length: text.length }
  }

  if (!flushing && isPendingPrefix(source)) {
    return { kind: 'pending', pending: source }
  }

  const csiU = CSI_U_RE.exec(source)
  if (csiU) {
    const codepoint = Number(csiU[1])
    const modifier = csiU[2] ? Number(csiU[2]) : 1
    return {
      kind: 'event',
      event: keycodeEvent(csiU[0], codepoint, modifier),
      length: csiU[0].length,
    }
  }

  const modifyOtherKeys = MODIFY_OTHER_KEYS_RE.exec(source)
  if (modifyOtherKeys) {
    return {
      kind: 'event',
      event: keycodeEvent(
        modifyOtherKeys[0],
        Number(modifyOtherKeys[2]),
        Number(modifyOtherKeys[1]),
      ),
      length: modifyOtherKeys[0].length,
    }
  }

  const known = KNOWN_SEQUENCES.find(entry => source.startsWith(entry.sequence))
  if (known) {
    return {
      kind: 'event',
      event: createInputEvent('', known.key, known.sequence),
      length: known.sequence.length,
    }
  }

  if (source.startsWith('\x1b\r') || source.startsWith('\x1b\n')) {
    return {
      kind: 'event',
      event: createInputEvent('', { meta: true, return: true }, source.slice(0, 2)),
      length: 2,
    }
  }

  if (source.length >= 2) {
    const next = source.slice(1, 2)
    return {
      kind: 'event',
      event: createInputEvent(next, { meta: true }, source.slice(0, 2)),
      length: 2,
    }
  }

  return {
    kind: 'event',
    event: createInputEvent('', { escape: true, meta: true }, ESC),
    length: 1,
  }
}

function createTextEvent(text: string): AppInputEvent {
  if (text === '\r' || text === '\n') return createInputEvent('', { return: true }, text)
  if (text === '\t') return createInputEvent('', { tab: true }, text)
  if (text === '\x7f' || text === '\b') return createInputEvent('', { backspace: true }, text)
  if (text.length === 1) {
    const code = text.charCodeAt(0)
    if (code > 0 && code <= 26) {
      return createInputEvent(
        String.fromCharCode('a'.charCodeAt(0) + code - 1),
        { ctrl: true },
        text,
      )
    }
    if (/[A-Z]/.test(text)) return createInputEvent(text, { shift: true }, text)
  }
  return createInputEvent(text, {}, text)
}

function keycodeEvent(raw: string, codepoint: number, modifier: number): AppInputEvent {
  const key = decodeModifier(modifier)
  if (codepoint === 13) return createInputEvent('', { ...key, return: true }, raw)
  if (codepoint === 27) return createInputEvent('', { ...key, escape: true, meta: true }, raw)
  const char = String.fromCodePoint(codepoint)
  return createInputEvent(char, key, raw)
}

function decodeModifier(modifier: number): Partial<Key> {
  const normalized = Math.max(1, modifier) - 1
  return {
    shift: Boolean(normalized & 1),
    meta: Boolean(normalized & 2),
    ctrl: Boolean(normalized & 4),
    super: Boolean(normalized & 8),
  }
}

function createInputEvent(
  input: string,
  key: Partial<Key>,
  raw: string,
  isPasted = false,
): AppInputEvent {
  return {
    input,
    key: {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      home: false,
      end: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      ...key,
    } as Key,
    raw,
    isPasted,
  }
}

function stringifyChunk(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
}

function isPendingPrefix(source: string): boolean {
  return PENDING_PREFIXES.some(sequence => sequence.startsWith(source) && sequence !== source)
}

function longestSuffixPrefix(source: string, markers: string[]): string {
  let best = ''
  for (const marker of markers) {
    const maxLength = Math.min(source.length, marker.length - 1)
    for (let length = 1; length <= maxLength; length += 1) {
      const suffix = source.slice(source.length - length)
      if (marker.startsWith(suffix) && suffix.length > best.length) best = suffix
    }
  }
  return best
}
