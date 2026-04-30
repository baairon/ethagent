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
  const borderColor = toneColor[tone]
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={2} paddingY={0}>
      <Box flexDirection="column">
        <Text color={borderColor} bold>{title}</Text>
        {subtitle ? (
          typeof subtitle === 'string'
            ? <Text color={theme.dim}>{subtitle}</Text>
            : subtitle
        ) : null}
      </Box>
      {children ? <Box flexDirection="column" marginTop={1}>{children}</Box> : null}
      {footer ? (
        <Box marginTop={1} borderTop={false}>
          <Text color={theme.dim}>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
