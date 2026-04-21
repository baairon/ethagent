import React, { useEffect, useState } from 'react'
import { Text, Box } from 'ink'
import { theme } from './theme.js'
const eyePalette: Array<[number, number, number]> = [
  [0xf5, 0xd8, 0xd8],
  [0xf5, 0xe7, 0xcf],
  [0xf5, 0xf0, 0xd4],
  [0xd4, 0xee, 0xdd],
  [0xd4, 0xe6, 0xf5],
] as const


function eyeGradientColor(t: number): string {
  const s = Math.max(0, Math.min(1, t)) * (eyePalette.length - 1)
  const i = Math.min(Math.floor(s), eyePalette.length - 2)
  const f = s - i
  const lo = eyePalette[i] ?? eyePalette[0]!
  const hi = eyePalette[i + 1] ?? eyePalette[eyePalette.length - 1]!
  const [r1, g1, b1] = lo
  const [r2, g2, b2] = hi
  const r = Math.round(r1 + (r2 - r1) * f)
  const g = Math.round(g1 + (g2 - g1) * f)
  const b = Math.round(b1 + (b2 - b1) * f)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
const eth = `░░░░░░░╗░░░░░░░░╗░░╗  ░░╗
░░╔════╝╚══░░╔══╝░░║  ░░║
░░░░░╗     ░░║   ░░░░░░░║
░░╔══╝     ░░║   ░░╔══░░║
░░░░░░░╗   ░░║   ░░║  ░░║
╚══════╝   ╚═╝   ╚═╝  ╚═╝`

const A = [
  ` █████╗ `,
  `██╔══██╗`,
  `███████║`,
  `██╔══██║`,
  `██║  ██║`,
  `╚═╝  ╚═╝`,
].join('\n')

const G = [
  ` ██████╗ `,
  `██╔════╝ `,
  `██║  ███╗`,
  `██║   ██║`,
  `╚██████╔╝`,
  ` ╚═════╝ `,
].join('\n')

const E = [
  `███████╗`,
  `██╔════╝`,
  `█████╗  `,
  `██╔══╝  `,
  `███████╗`,
  `╚══════╝`,
].join('\n')

const N = [
  `███╗   ██╗`,
  `████╗  ██║`,
  `██╔██╗ ██║`,
  `██║╚██╗██║`,
  `██║ ╚████║`,
  `╚═╝  ╚═══╝`,
].join('\n')

const T = [
  `████████╗`,
  `╚══██╔══╝`,
  `   ██║   `,
  `   ██║   `,
  `   ██║   `,
  `   ╚═╝   `,
].join('\n')

const eyes = `
                                         -+:
                   :=-                    -%@@@%.
             *@@@@@#-                           *@@-
          +@@.                                     +@
        @@=                               -#=-+++=+:
      #%        .:===-:                   -@* +@@@@%
           *@-+@@@@@:                    %@@+  @@@=#@
          *@=   @@@@@@@-                .@.@@@@@@@ :
        @@+=@@@@@@@@@@@@:               .% *@@@@@*-=
       #:-@ -@@@@@@@@@-+%                @  -@@@- #
       :  #+  @@@@@@@- -%                 =#     =
           -@:        *@                      .+%%
              :%#: --
              .-:
                                                           `

const Eyes = () => {
  const lines = eyes.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, li) => {
        const glyphPositions = [...line]
          .map((char, index) => ({ char, index }))
          .filter(entry => entry.char.trim().length > 0)
          .map(entry => entry.index)
        const firstGlyph = glyphPositions[0] ?? 0
        const lastGlyph = glyphPositions[glyphPositions.length - 1] ?? firstGlyph
        const span = Math.max(lastGlyph - firstGlyph, 1)

        return (
          <Text key={li}>
            {[...line].map((char, ci) => {
              if (!char.trim()) {
                return <Text key={ci}>{char}</Text>
              }
              const t = (ci - firstGlyph) / span
              return <Text key={ci} color={eyeGradientColor(t)}>{char}</Text>
            })}
          </Text>
        )
      })}
    </Box>
  )
}

type SplashProps = {
  contextLine?: string
  tipLine?: string
  compact?: boolean
}

const TAGLINE = ' privacy-first AI agent with a portable Ethereum identity '

export const BrandSplash: React.FC<SplashProps> = ({ contextLine, tipLine, compact }) => {
  const [width, setWidth] = useState<number>(() => process.stdout.columns ?? 80)

  useEffect(() => {
    const stdout = process.stdout
    const handleResize = () => setWidth(stdout.columns ?? 80)
    stdout.on('resize', handleResize)
    return () => {
      stdout.off('resize', handleResize)
    }
  }, [])

  const renderCompact = compact ?? width < 72

  if (renderCompact) {
    return (
      <Box flexDirection="column" alignSelf="flex-start" padding={1}>
        <Eyes />
        <Text bold color={theme.accentPrimary}>ethagent</Text>
        <Text color={theme.dim}>{TAGLINE.trim()}</Text>
        {contextLine ? <Text color={theme.dim}>{contextLine}</Text> : null}
        {tipLine ? <Text color={theme.dim}>{tipLine}</Text> : null}
      </Box>
    )
  }

  const ethLines = eth.split('\n')
  const aLines = A.split('\n')
  const gLines = G.split('\n')
  const eLines = E.split('\n')
  const nLines = N.split('\n')
  const tLines = T.split('\n')

  const w = 69
  const topPad = Math.max(0, w - TAGLINE.length - 1)

  const bottomInline = contextLine ? ` ${truncateToFit(contextLine, w - 4)} ` : ''
  const bottomPad = Math.max(0, w - bottomInline.length - 1)

  return (
    <Box flexDirection="column" alignSelf="flex-start" padding={1}>
      <Eyes />
      <Text>
        <Text color={theme.border}>╔═</Text>
        <Text color={theme.dim}>{TAGLINE}</Text>
        <Text color={theme.border}>{'═'.repeat(topPad)}╗</Text>
      </Text>
      {ethLines.map((_line, i) => (
        <Box key={i}>
          <Text color={theme.border}>║</Text>
          <Text color={theme.border}>{ethLines[i]}</Text>
          <Text color={theme.border}>{aLines[i]}</Text>
          <Text color={theme.border}>{gLines[i]}</Text>
          <Text color={theme.border}>{eLines[i]}</Text>
          <Text color={theme.border}>{nLines[i]}</Text>
          <Text color={theme.border}>{tLines[i]}</Text>
          <Text color={theme.border}>║</Text>
        </Box>
      ))}
      {bottomInline ? (
        <Text>
          <Text color={theme.border}>╚═</Text>
          <Text color={theme.accentMint}>{bottomInline}</Text>
          <Text color={theme.border}>{'═'.repeat(bottomPad)}╝</Text>
        </Text>
      ) : (
        <Text color={theme.border}>{'╚' + '═'.repeat(w) + '╝'}</Text>
      )}
      {tipLine ? (
        <Box marginTop={1}>
          <Text color={theme.dim}>{tipLine}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function truncateToFit(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return text.slice(0, max - 1) + '…'
}
