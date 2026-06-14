import React, { useEffect, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, gradientColor } from '../../../../ui/theme.js'

export const COMPACT_LINES = [
  '█▀▀ ▀█▀ █ █ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀',
  '██▄  █  █▀█ █▀█ █▄█ ██▄ █ ▀█  █ ',
]

export const COMPACT_SPLIT = 12

const COMPACT_WIDTH = Math.max(...COMPACT_LINES.map(line => line.length))

const ROW_SHADE = [1, 0.62]

export function shadeColor(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channel = (shift: number): string =>
    Math.round(((n >> shift) & 0xff) * factor).toString(16).padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

const CompactBanner: React.FC<{ columns: number }> = ({ columns }) => {
  if (columns < COMPACT_WIDTH) {
    const agent = 'agent'
    const maxAgent = Math.max(1, agent.length - 1)
    return (
      <Text bold>
        <Text color={theme.wordmarkEth}>eth</Text>
        {[...agent].map((ch, j) => (
          <Text key={j} color={gradientColor(j / maxAgent)}>{ch}</Text>
        ))}
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {COMPACT_LINES.map((line, i) => {
        const shade = ROW_SHADE[Math.min(i, ROW_SHADE.length - 1)]!
        const eth = line.slice(0, COMPACT_SPLIT)
        const agent = line.slice(COMPACT_SPLIT)
        const maxAgent = Math.max(1, agent.length - 1)
        return (
          <Text key={i} bold>
            <Text color={shadeColor(theme.wordmarkEth, shade)}>{eth}</Text>
            {[...agent].map((ch, j) => (
              <Text key={j} color={shadeColor(gradientColor(j / maxAgent), shade)}>{ch}</Text>
            ))}
          </Text>
        )
      })}
    </Box>
  )
}

// The compact block mark is the one universal wordmark, shown on every screen.
export const Wordmark: React.FC = () => {
  const { stdout } = useStdout()
  const [columns, setColumns] = useState<number>(() => Math.floor(stdout?.columns ?? 80))
  useEffect(() => {
    if (!stdout) return
    const handleResize = () => setColumns(Math.floor(stdout.columns ?? 80))
    stdout.on('resize', handleResize)
    return () => { stdout.off('resize', handleResize) }
  }, [stdout])

  return <CompactBanner columns={columns} />
}
