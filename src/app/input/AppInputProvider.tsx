import { useInput, type Key } from 'ink'

export type { Key }

export type InputHandler = (input: string, key: Key) => void

export type UseAppInputOptions = {
  isActive?: boolean
}

export function useAppInput(handler: InputHandler, options: UseAppInputOptions = {}): void {
  useInput(handler, options)
}
