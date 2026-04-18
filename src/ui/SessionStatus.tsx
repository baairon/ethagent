import React from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'

type StatusBarProps = {
  provider: string
  model: string
  turns: number
  approxTokens: number
  startedAt: number
}

const SessionStatusInner: React.FC<StatusBarProps> = ({
  provider,
  model,
  turns,
  approxTokens,
  startedAt,
}) => {
  return (
    <Box flexDirection="row">
      <Text color={theme.dim}>
        {provider} · {model} · {turns} {turns === 1 ? 'turn' : 'turns'} · ~{formatTokens(approxTokens)} tokens · {formatElapsed(Date.now() - startedAt)}
      </Text>
    </Box>
  )
}

export const SessionStatus = React.memo(SessionStatusInner)

export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  if (minutes < 60) return `${minutes}m${rem.toString().padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  const minRem = minutes % 60
  return `${hours}h${minRem.toString().padStart(2, '0')}m`
}

