import React from 'react'
import { Box, Text } from 'ink'
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

export const Wordmark: React.FC = () => (
  <Box flexDirection="row">
    <Text color={theme.wordmarkEth}>{LEFT_DECOR.join('\n')}</Text>
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
    <Text color={theme.wordmarkEth}>{RIGHT_DECOR.join('\n')}</Text>
  </Box>
)
