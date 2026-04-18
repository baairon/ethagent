import React from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'

type SurfaceTone = 'primary' | 'muted' | 'error'

type SurfaceProps = {
  title: string
  subtitle?: React.ReactNode
  footer?: React.ReactNode
  tone?: SurfaceTone
  children?: React.ReactNode
}

const toneColor: Record<SurfaceTone, string> = {
  primary: theme.accentPrimary,
  muted: theme.border,
  error: '#e87070',
}

export const Surface: React.FC<SurfaceProps> = ({
  title,
  subtitle,
  footer,
  tone = 'primary',
  children,
}) => {
  const color = toneColor[tone]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color} bold>{title}</Text>
      {subtitle ? <Text color={theme.dim}>{subtitle}</Text> : null}
      {children ? <Box flexDirection="column" marginTop={1}>{children}</Box> : null}
      {footer ? <Box marginTop={1}><Text color={theme.dim}>{footer}</Text></Box> : null}
    </Box>
  )
}

export default Surface
