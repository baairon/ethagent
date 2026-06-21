import React from 'react'
import { Box, Text } from 'ink'
import { theme, PANEL_WIDTH } from './theme.js'

type SurfaceTone = 'primary' | 'muted' | 'error'

type SurfaceProps = {
  title: string
  subtitle?: React.ReactNode
  footer?: React.ReactNode
  tone?: SurfaceTone
  children?: React.ReactNode
}

const toneColor: Record<SurfaceTone, string> = {
  primary: theme.accentWhite,
  muted: theme.dim,
  error: theme.accentError,
}

export const Surface: React.FC<SurfaceProps> = ({
  title,
  subtitle,
  footer,
  tone = 'primary',
  children,
}) => {
  const titleColor = toneColor[tone]
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1} width="100%">
      <Box flexDirection="column" paddingX={2} width={PANEL_WIDTH}>
        <Box flexDirection="column">
          <Text color={titleColor} bold>{title}</Text>
          {subtitle ? (
            typeof subtitle === 'string'
              ? <Text color={theme.menuStatus}>{subtitle}</Text>
              : subtitle
          ) : null}
        </Box>
        {children ? <Box flexDirection="column" marginTop={1}>{children}</Box> : null}
        {footer ? (
          <Box marginTop={1} justifyContent="center">
            {typeof footer === 'string'
              ? <Text color={theme.menuStatus}>{footer}</Text>
              : footer}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
