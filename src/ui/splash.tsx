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
  statusLine?: string
  compact?: boolean
}

const TAGLINE = ' privacy-first AI agent with a portable ethereum identity '

export const Splash: React.FC<SplashProps> = ({ statusLine, compact }) => {
  const width = process.stdout.columns ?? 80
  const renderCompact = compact ?? width < 72

  if (renderCompact) {
    return (
      <Box flexDirection="column" alignSelf="flex-start" padding={1}>
        <Eyes />
        <Text bold color={theme.accentPrimary}>ethagent</Text>
        <Text color={theme.dim}>{TAGLINE.trim()}</Text>
        {statusLine ? <Text color={theme.accentSecondary}>{statusLine}</Text> : null}
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
  const pad = Math.max(0, w - TAGLINE.length - 1)

  return (
    <Box flexDirection="column" alignSelf="flex-start" padding={1}>
      <Eyes />
      <Text>
        <Text color={theme.border}>╔═</Text>
        <Text color={theme.dim}>{TAGLINE}</Text>
        <Text color={theme.border}>{'═'.repeat(pad)}╗</Text>
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
      <Text color={theme.border}>{'╚' + '═'.repeat(w) + '╝'}</Text>
      {statusLine ? <Text color={theme.accentSecondary}>{statusLine}</Text> : null}
    </Box>
  )
}

export default Splash
