import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { theme } from './theme.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80

type SpinnerProps = {
  label?: string
  color?: string
  hint?: string
}

export const Spinner: React.FC<SpinnerProps> = ({ label, color = theme.accentPrimary, hint }) => {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text>
      <Text color={color}>{FRAMES[frame]}</Text>
      {label ? <Text color={theme.dim}> {label}</Text> : null}
      {hint ? <Text color={theme.dim}> · {hint}</Text> : null}
    </Text>
  )
}

export default Spinner
