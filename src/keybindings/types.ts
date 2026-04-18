export type KeybindingContextName = 'Global' | 'Chat' | 'Overlay'

export const ACTIONS = [
  'app:interrupt',
  'app:redraw',
  'chat:cancel',
  'chat:modelPicker',
  'chat:cycleMode',
] as const

export type Action = (typeof ACTIONS)[number]

export type Keystroke = {
  key: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
}

export type Binding = {
  context: KeybindingContextName
  chord: Keystroke
  action: Action
}
