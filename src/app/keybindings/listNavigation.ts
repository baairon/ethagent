import type { Key } from 'ink'
import { resolveKey } from './resolver.js'
import type { Binding, ListAction } from './types.js'

export const LIST_BINDINGS: Binding<ListAction>[] = [
  { context: 'List', chord: { key: 'up' }, action: 'list:up' },
  { context: 'List', chord: { key: 'k' }, action: 'list:up' },
  { context: 'List', chord: { key: 'down' }, action: 'list:down' },
  { context: 'List', chord: { key: 'j' }, action: 'list:down' },
  { context: 'List', chord: { key: 'pageup' }, action: 'list:pageUp' },
  { context: 'List', chord: { key: 'u', ctrl: true }, action: 'list:pageUp' },
  { context: 'List', chord: { key: 'pagedown' }, action: 'list:pageDown' },
  { context: 'List', chord: { key: 'd', ctrl: true }, action: 'list:pageDown' },
  { context: 'List', chord: { key: 'home' }, action: 'list:first' },
  { context: 'List', chord: { key: 'g' }, action: 'list:first' },
  { context: 'List', chord: { key: 'end' }, action: 'list:last' },
  { context: 'List', chord: { key: 'g', shift: true }, action: 'list:last' },
]

export type ListPosition = {
  index: number
  count: number
  page: number
  selectable: (index: number) => boolean
}

export function moveInList(action: ListAction, { index, count, page, selectable }: ListPosition): number {
  if (count <= 0) return index

  const seek = (from: number, step: number, stop: number): number => {
    for (let at = from; step > 0 ? at < stop : at > stop; at += step) {
      if (selectable(at)) return at
    }
    return -1
  }

  let found = -1
  if (action === 'list:first') {
    found = seek(0, 1, count)
  } else if (action === 'list:last') {
    found = seek(count - 1, -1, -1)
  } else if (action === 'list:up' || action === 'list:down') {
    const step = action === 'list:up' ? -1 : 1
    for (let offset = 1; offset <= count && found === -1; offset += 1) {
      const at = (((index + step * offset) % count) + count) % count
      if (selectable(at)) found = at
    }
  } else {
    const step = action === 'list:pageUp' ? -1 : 1
    const target = Math.max(0, Math.min(count - 1, index + step * Math.max(1, page)))
    found = seek(target, step, step > 0 ? count : -1)
    if (found === -1) found = seek(target - step, -step, index)
  }
  return found === -1 ? index : found
}

export function navigateList(input: string, key: Key, list: ListPosition): number | null {
  const action = resolveKey(input, key, ['List'], LIST_BINDINGS)
  return action ? moveInList(action, list) : null
}
