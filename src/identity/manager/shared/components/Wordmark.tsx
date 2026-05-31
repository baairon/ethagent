import React, { useEffect, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, gradientColor } from '../../../../ui/theme.js'

export const LINES = [
  '░░░░░░░╗░░░░░░░░╗░░╗  ░░╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗',
  '░░╔════╝╚══░░╔══╝░░║  ░░║██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝',
  '░░░░░╗     ░░║   ░░░░░░░║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ',
  '░░╔══╝     ░░║   ░░╔══░░║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ',
  '░░░░░░░╗   ░░║   ░░║  ░░║██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ',
  '╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ',
]

export const SPLIT = 25

export const LEFT_DECOR = [
  '         ✦  ',
  '   ⊹        ',
  '            ',
  '         .  ',
  '            ',
  ' ฅ^•ﻌ•マ    ',
]

export const RIGHT_DECOR = [
  '  ˖    𐰁    ',
  '            ',
  '     𝗓      ',
  '          ⊹ ',
  '   ᶻ        ',
  '            ',
]

const WORDMARK_WIDTH = Math.max(...LINES.map(line => line.length))
const DECOR_WIDTH = 12

export type WordmarkLayout = 'full' | 'bare' | 'hidden'

export function wordmarkLayout(columns: number): WordmarkLayout {
  if (columns >= WORDMARK_WIDTH + DECOR_WIDTH * 2) return 'full'
  if (columns >= WORDMARK_WIDTH) return 'bare'
  return 'hidden'
}

const Banner: React.FC = () => (
  <Box flexDirection="column">
    {LINES.map((line, i) => {
      const eth = line.slice(0, SPLIT)
      const agent = line.slice(SPLIT)
      const maxAgent = Math.max(1, agent.length - 1)
      return (
        <Text key={i}>
          <Text color={theme.wordmarkEth}>{eth}</Text>
          {[...agent].map((ch, j) => (
            <Text key={j} color={gradientColor(j / maxAgent)}>{ch}</Text>
          ))}
        </Text>
      )
    })}
  </Box>
)

export const Wordmark: React.FC = () => {
  const { stdout } = useStdout()
  const [columns, setColumns] = useState<number>(() => Math.floor(stdout?.columns ?? 80))
  useEffect(() => {
    if (!stdout) return
    const handleResize = () => setColumns(Math.floor(stdout.columns ?? 80))
    stdout.on('resize', handleResize)
    return () => { stdout.off('resize', handleResize) }
  }, [stdout])

  const layout = wordmarkLayout(columns)
  if (layout === 'hidden') return null
  if (layout === 'bare') return <Banner />

  return (
    <Box flexDirection="row">
      <Text color={theme.wordmarkEth}>{LEFT_DECOR.join('\n')}</Text>
      <Banner />
      <Text color={theme.wordmarkEth}>{RIGHT_DECOR.join('\n')}</Text>
    </Box>
  )
}
