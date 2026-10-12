import type { Key } from 'ink'
import type { Action, Binding, KeybindingContextName } from './types.js'

export function resolveKey<A extends Action>(
  input: string,
  key: Key,
  activeContexts: KeybindingContextName[],
  bindings: Binding<A>[],
): A | null {
  const ctxSet = new Set(activeContexts)
  let match: Binding<A> | undefined
  for (const binding of bindings) {
    if (!ctxSet.has(binding.context)) continue
    if (matchesChord(input, key, binding.chord)) {
      match = binding
    }
  }
  return match?.action ?? null
}

function matchesChord(input: string, key: Key, chord: Binding['chord']): boolean {
  if ((chord.ctrl ?? false) !== key.ctrl) return false
  if ((chord.shift ?? false) !== key.shift) return false
  if ((chord.meta ?? false) !== (key.meta && !key.escape)) return false
  return keyNameOf(input, key) === chord.key
}

function keyNameOf(input: string, key: Key): string | null {
  if (key.escape) return 'escape'
  if (key.return) return 'return'
  if (key.tab) return 'tab'
  if (key.upArrow) return 'up'
  if (key.downArrow) return 'down'
  if (key.leftArrow) return 'left'
  if (key.rightArrow) return 'right'
  if (key.backspace) return 'backspace'
  if (key.delete) return 'delete'
  if (key.pageUp) return 'pageup'
  if (key.pageDown) return 'pagedown'
  if (key.home) return 'home'
  if (key.end) return 'end'
  if (!input) return null
  return input.length === 1 ? input.toLowerCase() : input
}
