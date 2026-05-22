import React, { useEffect, useState } from 'react'
import { Text, Box } from 'ink'
import { theme } from './theme.js'

const glyphs = {
  ethagent: `░░░░░░░╗░░░░░░░░╗░░╗  ░░╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗
░░╔════╝╚══░░╔══╝░░║  ░░║██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
░░░░░╗     ░░║   ░░░░░░░║███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
░░╔══╝     ░░║   ░░╔══░░║██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
░░░░░░░╗   ░░║   ░░║  ░░║██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   `,
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

const Eyes = () => {
  const lines = glyphs.eyes.split('\n')
  return (
    <Box flexDirection="column">
      {lines.map((line, li) => (
        <Text key={li} color={theme.text}>{line}</Text>
      ))}
    </Box>
  )
}

type SplashProps = {
  contextLine?: string
  tipLine?: string
  updateNotice?: string | null
  compact?: boolean
  showTagline?: boolean
}

export const BrandSplash: React.FC<SplashProps> = ({ contextLine, tipLine, updateNotice, compact, showTagline }) => {
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
        <Text bold color={theme.accentWhite}>ethagent</Text>
        {contextLine ? <Text color={theme.dim}>{contextLine}</Text> : null}
        {tipLine ? <Text color={theme.dim}>{tipLine}</Text> : null}
        {updateNotice ? <Text color={theme.accentPeriwinkle}>{updateNotice}</Text> : null}
      </Box>
    )
  }

  const w = 69
  const logoLines = glyphs.ethagent.split('\n').map(line => line.padEnd(w, ' '))

  const bottomInline = contextLine ? ` ${truncateToFit(contextLine, w - 4)} ` : ''
  const bottomPad = Math.max(0, w - bottomInline.length - 1)

  return (
    <Box flexDirection="column" alignSelf="flex-start" padding={1}>
      <Eyes />
      {showTagline ? (
        <Text>
          <Text color={theme.accentWhite}>{glyphs.frame.topLeft}</Text>
          <Text color={theme.accentPeriwinkle}>{glyphs.tagline}</Text>
          <Text color={theme.accentWhite}>{glyphs.frame.horizontal.repeat(Math.max(0, w - glyphs.tagline.length - 1))}{glyphs.frame.topRight}</Text>
        </Text>
      ) : (
        <Text color={theme.accentWhite}>{glyphs.frame.topLeft.slice(0, 1) + glyphs.frame.horizontal.repeat(w) + glyphs.frame.topRight}</Text>
      )}
      {logoLines.map((line, i) => (
        <Box key={i}>
          <Text color={theme.accentWhite}>{glyphs.frame.side}</Text>
          <Text color={theme.accentWhite}>{line}</Text>
          <Text color={theme.accentWhite}>{glyphs.frame.side}</Text>
        </Box>
      ))}
      {bottomInline ? (
        <Text>
          <Text color={theme.accentWhite}>{glyphs.frame.bottomLeft}</Text>
          <Text color={theme.accentPeriwinkle}>{bottomInline}</Text>
          <Text color={theme.accentWhite}>{glyphs.frame.horizontal.repeat(bottomPad)}{glyphs.frame.bottomRight}</Text>
        </Text>
      ) : (
        <Text color={theme.accentWhite}>{glyphs.frame.bottomLeft.slice(0, 1) + glyphs.frame.horizontal.repeat(w) + glyphs.frame.bottomRight}</Text>
      )}
      {tipLine || updateNotice ? (
        <Box marginTop={1} flexDirection="column">
          {tipLine ? <Text color={theme.dim}>{tipLine}</Text> : null}
          {updateNotice ? <Text color={theme.accentPeriwinkle}>{updateNotice}</Text> : null}
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
