import { useCallback } from 'react'
import { useKeybinding } from '../keybindings/KeybindingProvider.js'

type Options = {
  abortSignal?: AbortSignal
  onCancel: () => void
  isActive?: boolean
}

export function useCancelRequest({ abortSignal, onCancel, isActive = true }: Options): void {
  const canCancel = abortSignal !== undefined && !abortSignal.aborted

  const handleCancel = useCallback(() => {
    if (!canCancel) return
    onCancel()
  }, [canCancel, onCancel])

  useKeybinding('chat:cancel', handleCancel, {
    context: 'Chat',
    isActive: isActive && canCancel,
  })
}
