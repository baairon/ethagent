import { useCallback, useMemo, useState } from 'react'
import { useApp } from 'ink'
import { useKeybinding } from '../keybindings/KeybindingProvider.js'
import { useDoublePress } from './useDoublePress.js'

export type ExitState = {
  pending: boolean
  keyName: 'ctrl+c' | null
}

type Options = {
  isActive?: boolean
  onInterrupt?: () => boolean
  onExit?: () => void
}

export function useExitOnCtrlC({ isActive = true, onInterrupt, onExit }: Options = {}): ExitState {
  const { exit } = useApp()
  const [state, setState] = useState<ExitState>({ pending: false, keyName: null })

  const exitFn = useMemo(() => onExit ?? exit, [onExit, exit])

  const ctrlCDouble = useDoublePress(
    pending => setState({ pending, keyName: 'ctrl+c' }),
    exitFn,
  )

  const handleInterrupt = useCallback(() => {
    if (onInterrupt?.()) return
    ctrlCDouble()
  }, [onInterrupt, ctrlCDouble])

  useKeybinding('app:interrupt', handleInterrupt, { context: 'Global', isActive })

  return state
}
