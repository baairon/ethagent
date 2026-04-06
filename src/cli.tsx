#!/usr/bin/env node
import React from 'react'
import {render, Text, Box} from 'ink'

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

const palette = [
  [0xe8, 0xa0, 0xa0],
  [0xe8, 0xbe, 0x8f],
  [0xe8, 0xdf, 0x9a],
  [0x96, 0xd4, 0xa8],
  [0x90, 0xb8, 0xe8],
]

function gradientColor(t) {
  const s = Math.max(0, Math.min(1, t)) * (palette.length - 1)
  const i = Math.min(Math.floor(s), palette.length - 2)
  const f = s - i
  const [r1, g1, b1] = palette[i]
  const [r2, g2, b2] = palette[i + 1]
  const r = Math.round(r1 + (r2 - r1) * f)
  const g = Math.round(g1 + (g2 - g1) * f)
  const b = Math.round(b1 + (b2 - b1) * f)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

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

const App = () => {
  const ethLines = eth.split('\n')
  const aLines = A.split('\n')
  const gLines = G.split('\n')
  const eLines = E.split('\n')
  const nLines = N.split('\n')
  const tLines = T.split('\n')

  const w = 69
  const topLabel = ' local AI agent with a portable ethereum identity '

  return (
    <Box flexDirection="column" alignSelf="flex-start" padding={1}>
      <Eyes />
      <Text>
        <Text color="#555555">╔═</Text>
        <Text color="#777777">{topLabel}</Text>
        <Text color="#555555">{'═'.repeat(w - topLabel.length - 1)}╗</Text>
      </Text>
      {ethLines.map((line, i) => (
        <Box key={i}>
          <Text color="#555555">║</Text>
          <Text color="#555555">{ethLines[i]}</Text>
          <Text color="#555555">{aLines[i]}</Text>
          <Text color="#555555">{gLines[i]}</Text>
          <Text color="#555555">{eLines[i]}</Text>
          <Text color="#555555">{nLines[i]}</Text>
          <Text color="#555555">{tLines[i]}</Text>
          <Text color="#555555">║</Text>
        </Box>
      ))}
      <Text color="#555555">{'╚' + '═'.repeat(w) + '╝'}</Text>
      <Text color="#777777">{'\n coming soon...\n'}</Text>
    </Box>
  )
}

render(<App />)
