import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../../ui/theme.js'
import { useContentWidth } from '../../../../ui/layout.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import { readIdentityStateString } from '../../custody/state.js'
import { identityNetworkName } from '../model/network.js'

interface IdentitySummaryProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
}

type Segment = { text: string; color: string; bold?: boolean }

const SEPARATOR = ' · '

export const IdentitySummary: React.FC<IdentitySummaryProps> = ({ identity, config }) => {
  const contentWidth = useContentWidth()
  if (!identity) {
    return <Text color={theme.dim}>No agent yet. Create or load one.</Text>
  }

  const segments: Segment[] = [{ text: readIdentityStateString(identity.state, 'name') || 'Unnamed Agent', color: theme.text, bold: true }]
  if (identity.agentId) {
    segments.push({ text: `#${identity.agentId}`, color: theme.dim })
    const network = identityNetworkName(identity, config)
    if (network) segments.push({ text: network, color: theme.dim })
  }

  return (
    <Box flexDirection="column">
      {packSegments(segments, contentWidth).map((line, lineIndex) => (
        <Text key={lineIndex}>
          {line.map((segment, index) => (
            <React.Fragment key={index}>
              {index > 0 ? <Text color={theme.dim}>{SEPARATOR}</Text> : null}
              <Text color={segment.color} bold={segment.bold}>{segment.text}</Text>
            </React.Fragment>
          ))}
        </Text>
      ))}
    </Box>
  )
}

function packSegments(segments: Segment[], width: number): Segment[][] {
  const lines: Segment[][] = []
  let current: Segment[] = []
  let used = 0
  for (const segment of segments) {
    const extra = current.length > 0 ? SEPARATOR.length + segment.text.length : segment.text.length
    if (current.length > 0 && used + extra > width) {
      lines.push(current)
      current = [segment]
      used = segment.text.length
    } else {
      current.push(segment)
      used += extra
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}
