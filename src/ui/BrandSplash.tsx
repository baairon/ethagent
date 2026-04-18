import React from 'react'
import { Text, Box } from 'ink'
import { gradientColor, theme } from './theme.js'

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
  const maxLen = Math.max(...lines.map(l => l.trimEnd().length))
  return (
    <Box flexDirection="column">
      {lines.map((line, li) => (
        <Text key={li}>
          {line.split('').map((char, ci) => (
            <Text key={ci} color={gradientColor(ci / Math.max(maxLen - 1, 1))}>{char}</Text>
          ))}
        </Text>
      ))}
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
  const width = process.stdout.columns ?? 80
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

export default BrandSplash
