import React, { useEffect, useRef, useState } from 'react'
import { Text } from 'ink'
import { theme } from './theme.js'
import { pickVerb } from '../constants/spinnerVerbs.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80
const ELAPSED_MIN_MS = 2000

type SpinnerProps = {
  active?: boolean
  hint?: string
  label?: string
  verb?: string
  color?: string
}

export const Spinner: React.FC<SpinnerProps> = ({
  active = true,
  hint,
  label,
  verb,
  color = theme.accentPrimary,
}) => {
  const [frame, setFrame] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const stickyVerbRef = useRef<string | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      stickyVerbRef.current = null
      startRef.current = null
      setElapsedMs(0)
      return
    }
    if (label === undefined && stickyVerbRef.current === null) {
      stickyVerbRef.current = verb ?? pickVerb()
    }
    if (startRef.current === null) startRef.current = Date.now()
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length)
      if (startRef.current !== null) setElapsedMs(Date.now() - startRef.current)
    }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active, verb, label])

  if (!active) return null

  const autoLabel = stickyVerbRef.current ?? verb ?? 'thinking'
  const showElapsed = label === undefined && elapsedMs >= ELAPSED_MIN_MS
  const seconds = Math.floor(elapsedMs / 1000)
  const text = label ?? `${autoLabel}…`

  return (
    <Text>
      <Text color={color}>{FRAMES[frame]}</Text>
      <Text color={theme.dim}> {text}</Text>
      {showElapsed ? <Text color={theme.dim}> {seconds}s</Text> : null}
      {hint ? <Text color={theme.dim}> · {hint}</Text> : null}
    </Text>
  )
}

export default Spinner
