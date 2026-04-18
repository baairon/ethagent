import React, { useEffect, useRef, useState } from 'react'
import { Text } from 'ink'
import { theme } from './theme.js'
import { pickVerb } from '../constants/spinnerVerbs.js'

type SpinnerProps = {
  active?: boolean
  hint?: string
  label?: string
  verb?: string
  color?: string
}

const FRAMES = ['.', 'o', 'O', 'o']

export const Spinner: React.FC<SpinnerProps> = ({
  active = true,
  hint,
  label,
  verb,
  color = theme.accentSecondary,
}) => {
  const stickyVerbRef = useRef<string | null>(null)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) {
      stickyVerbRef.current = null
      return
    }

    if (label === undefined && stickyVerbRef.current === null) {
      stickyVerbRef.current = verb ?? pickVerb()
    }
  }, [active, verb, label])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % FRAMES.length)
    }, 120)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  const autoLabel = stickyVerbRef.current ?? verb ?? 'thinking'
  const text = label ?? `${autoLabel}...`
  const glyph = FRAMES[frame] ?? 'o'

  return (
    <Text>
      <Text color={color}>{glyph}</Text>
      <Text color={theme.textSubtle}> {text}</Text>
      {hint ? <Text color={theme.dim}> / {hint}</Text> : null}
    </Text>
  )
}

export default Spinner
