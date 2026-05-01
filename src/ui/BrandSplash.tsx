import React, { useEffect, useState } from 'react'
import { Text, Box } from 'ink'
import { eyeGradientColor, theme } from './theme.js'

const glyphs = {
  ethagent: {
    eth: `░░░░░░░╗░░░░░░░░╗░░╗  ░░╗
░░╔════╝╚══░░╔══╝░░║  ░░║
░░░░░╗     ░░║   ░░░░░░░║
░░╔══╝     ░░║   ░░╔══░░║
░░░░░░░╗   ░░║   ░░║  ░░║
╚══════╝   ╚═╝   ╚═╝  ╚═╝`,
    a: [
      ` █████╗ `,
      `██╔══██╗`,
      `███████║`,
      `██╔══██║`,
      `██║  ██║`,
      `╚═╝  ╚═╝`,
    ].join('\n'),
    g: [
      ` ██████╗ `,
      `██╔════╝ `,
      `██║  ███╗`,
      `██║   ██║`,
      `╚██████╔╝`,
      ` ╚═════╝ `,
    ].join('\n'),
    e: [
      `███████╗`,
      `██╔════╝`,
      `█████╗  `,
      `██╔══╝  `,
      `███████╗`,
      `╚══════╝`,
    ].join('\n'),
    n: [
      `███╗   ██╗`,
      `████╗  ██║`,
      `██╔██╗ ██║`,
      `██║╚██╗██║`,
      `██║ ╚████║`,
      `╚═╝  ╚═══╝`,
    ].join('\n'),
    t: [
      `████████╗`,
      `╚══██╔══╝`,
      `   ██║   `,
      `   ██║   `,
      `   ██║   `,
      `   ╚═╝   `,
    ].join('\n'),
  },
  eyes: `
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
                                                           `,
  tagline: ' privacy-first AI agent with a portable Ethereum identity ',
  ellipsis: '…',
  frame: {
    topLeft: '╔═',
    topRight: '╗',
    side: '║',
    bottomLeft: '╚═',
    bottomRight: '╝',
    horizontal: '═',
  },
} as const

const ethagentGlyphOrder = ['eth', 'a', 'g', 'e', 'n', 't'] as const

const Eyes = () => {
  const lines = glyphs.eyes.split('\n')
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
  updateNotice?: string | null
  compact?: boolean
}

export const BrandSplash: React.FC<SplashProps> = ({ contextLine, tipLine, updateNotice, compact }) => {
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
        <Text color={theme.dim}>{glyphs.tagline.trim()}</Text>
        {contextLine ? <Text color={theme.dim}>{contextLine}</Text> : null}
        {tipLine ? <Text color={theme.dim}>{tipLine}</Text> : null}
        {updateNotice ? <Text color={theme.accentPeach}>{updateNotice}</Text> : null}
      </Box>
    )
  }

  const logoLines = ethagentGlyphOrder.map(key => glyphs.ethagent[key].split('\n'))
  const rowCount = Math.max(...logoLines.map(lines => lines.length))

  const w = 69
  const topPad = Math.max(0, w - glyphs.tagline.length - 1)

  const bottomInline = contextLine ? ` ${truncateToFit(contextLine, w - 4)} ` : ''
  const bottomPad = Math.max(0, w - bottomInline.length - 1)

  return (
    <Box flexDirection="column" alignSelf="flex-start" padding={1}>
      <Eyes />
      <Text>
        <Text color={theme.border}>{glyphs.frame.topLeft}</Text>
        <Text color={theme.dim}>{glyphs.tagline}</Text>
        <Text color={theme.border}>{glyphs.frame.horizontal.repeat(topPad)}{glyphs.frame.topRight}</Text>
      </Text>
      {Array.from({ length: rowCount }, (_, i) => (
        <Box key={i}>
          <Text color={theme.border}>{glyphs.frame.side}</Text>
          {logoLines.map((lines, index) => (
            <Text key={ethagentGlyphOrder[index]} color={theme.border}>{lines[i] ?? ''}</Text>
          ))}
          <Text color={theme.border}>{glyphs.frame.side}</Text>
        </Box>
      ))}
      {bottomInline ? (
        <Text>
          <Text color={theme.border}>{glyphs.frame.bottomLeft}</Text>
          <Text color={theme.accentMint}>{bottomInline}</Text>
          <Text color={theme.border}>{glyphs.frame.horizontal.repeat(bottomPad)}{glyphs.frame.bottomRight}</Text>
        </Text>
      ) : (
        <Text color={theme.border}>{glyphs.frame.bottomLeft.slice(0, 1) + glyphs.frame.horizontal.repeat(w) + glyphs.frame.bottomRight}</Text>
      )}
      {tipLine || updateNotice ? (
        <Box marginTop={1} flexDirection="column">
          {tipLine ? <Text color={theme.dim}>{tipLine}</Text> : null}
          {updateNotice ? <Text color={theme.accentPeach}>{updateNotice}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}

function truncateToFit(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 1) return text.slice(0, Math.max(0, max))
  return text.slice(0, max - 1) + glyphs.ellipsis
}
