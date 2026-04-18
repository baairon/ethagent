
import { useCallback, useEffect, useRef } from 'react'

export const DOUBLE_PRESS_TIMEOUT_MS = 800

export function useDoublePress(
  setPending: (pending: boolean) => void,
  onDoublePress: () => void,
  onFirstPress?: () => void,
): () => void {
  const lastPressRef = useRef<number>(0)
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [])

  useEffect(() => {
    return () => {
      clearPendingTimeout()
    }
  }, [clearPendingTimeout])

  return useCallback(() => {
    const now = Date.now()
    const elapsed = now - lastPressRef.current
    const isDouble = elapsed <= DOUBLE_PRESS_TIMEOUT_MS && timeoutRef.current !== undefined

    if (isDouble) {
      clearPendingTimeout()
      setPending(false)
      onDoublePress()
    } else {
      onFirstPress?.()
      setPending(true)
      clearPendingTimeout()
      timeoutRef.current = setTimeout(() => {
        setPending(false)
        timeoutRef.current = undefined
      }, DOUBLE_PRESS_TIMEOUT_MS)
    }

    lastPressRef.current = now
  }, [setPending, onDoublePress, onFirstPress, clearPendingTimeout])
}
