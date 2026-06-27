import React, { useEffect, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, gradientColor, lerpHex } from '../../../../ui/theme.js'

const COMPACT_LINES = [
  '█▀▀ ▀█▀ █ █ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀',
  '██▄  █  █▀█ █▀█ █▄█ ██▄ █ ▀█  █ ',
]

const COMPACT_SPLIT = 12

const COMPACT_WIDTH = Math.max(...COMPACT_LINES.map(line => line.length))

// Brightness shade: multiply RGB channels by a factor
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number): string =>
    Math.min(255, Math.round(((n >> shift) & 0xff) * factor)).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

// Eth half: steel-blue diagonal sheen
const ETH_HIGHLIGHT = '#d8e0f0'
const ETH_TOP = '#a0b0cc'
const ETH_BASE = '#7888a8'
const ETH_SHADE = '#506078'

function getEthSheen(t: number): string {
  if (t < 0.2) return lerpHex(ETH_HIGHLIGHT, ETH_TOP, t / 0.2)
  if (t < 0.5) return lerpHex(ETH_TOP, ETH_BASE, (t - 0.2) / 0.3)
  return lerpHex(ETH_BASE, ETH_SHADE, (t - 0.5) / 0.5)
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

  const rows = COMPACT_LINES.length
  return (
    <Box flexDirection="column">
      {COMPACT_LINES.map((line, row) => {
        const tY = row / (rows - 1 || 1)
        const eth = line.slice(0, COMPACT_SPLIT)
        const agent = line.slice(COMPACT_SPLIT)
        const ethChars = [...eth]
        const agentChars = [...agent]
        const ethLast = Math.max(1, ethChars.length - 1)
        const agentLast = Math.max(1, agentChars.length - 1)

        return (
          <Box key={row}>
            {ethChars.map((ch, i) => {
              if (ch === ' ') return <Text key={`e${i}`}> </Text>
              const factor = ((i / ethLast) + tY) / 2
              return (
                <Text key={`e${i}`} bold color={getEthSheen(factor)}>
                  {ch}
                </Text>
              )
            })}
            {agentChars.map((ch, j) => {
              if (ch === ' ') return <Text key={`a${j}`}> </Text>
              const tX = j / agentLast
              // Highlight top-left (1.25), fade to shadow bottom-right (0.75)
              const brightness = 1.25 - ((tX + tY) / 2) * 0.5
              return (
                <Text key={`a${j}`} bold color={shade(gradientColor(tX), brightness)}>
                  {ch}
                </Text>
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}

export const Logo: React.FC = () => {
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
