import React from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { usePanelWidth } from './layout.js'
import { Paragraph } from './Paragraph.js'

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
  const panelWidth = usePanelWidth()
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1} width="100%">
      <Box flexDirection="column" paddingX={2} width={panelWidth}>
        <Box flexDirection="column">
          <Paragraph color={toneColor[tone]} bold>{title}</Paragraph>
          {subtitle ? (
            typeof subtitle === 'string'
              ? <Paragraph color={theme.menuStatus}>{subtitle}</Paragraph>
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
