import type { Binding } from './types.js'

export const DEFAULT_BINDINGS: Binding[] = [
  { context: 'Global', chord: { key: 'c', ctrl: true },        action: 'app:interrupt' },
  { context: 'Global', chord: { key: 'l', ctrl: true },        action: 'app:redraw' },

  { context: 'Chat',   chord: { key: 'escape' },               action: 'chat:cancel' },
  { context: 'Chat',   chord: { key: 'return' },               action: 'chat:submit' },
  { context: 'Chat',   chord: { key: 'p', meta: true },        action: 'chat:modelPicker' },
  { context: 'Chat',   chord: { key: 'tab', shift: true },     action: 'chat:cycleMode' },
  { context: 'Chat',   chord: { key: 'up' },                   action: 'history:previous' },
  { context: 'Chat',   chord: { key: 'down' },                 action: 'history:next' },
]
