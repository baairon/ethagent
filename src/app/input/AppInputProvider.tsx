import { useInput, type Key } from 'ink'

export type { Key }

export type InputHandler = (input: string, key: Key) => void

export type UseAppInputOptions = {
  isActive?: boolean
}

// Thin wrapper over Ink's built-in useInput. Ink's parseKeypress already decodes
// modified arrows (shift/ctrl/meta), Home/End, and the Kitty keyboard protocol, so
// we no longer hand-roll terminal escape-sequence parsing or manage raw mode here.
export function useAppInput(handler: InputHandler, options: UseAppInputOptions = {}): void {
  useInput(handler, options)
}
