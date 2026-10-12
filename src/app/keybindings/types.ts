export type KeybindingContextName = 'Global' | 'List'

export const ACTIONS = [
  'app:interrupt',
  'app:redraw',
  'list:up',
  'list:down',
  'list:pageUp',
  'list:pageDown',
  'list:first',
  'list:last',
] as const

export type Action = (typeof ACTIONS)[number]

export type ListAction = Extract<Action, `list:${string}`>

export type Keystroke = {
  key: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
}

export type Binding<A extends Action = Action> = {
  context: KeybindingContextName
  chord: Keystroke
  action: A
}
