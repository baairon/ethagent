import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Spinner } from '../../ui/Spinner.js'
import { theme } from '../../ui/theme.js'
import { useAppInput } from '../../input/AppInputProvider.js'

type BusyScreenProps = {
  title: string
  subtitle?: React.ReactNode
  label: string
  footer?: React.ReactNode
  onCancel?: () => void
}

export const BusyScreen: React.FC<BusyScreenProps> = ({ title, subtitle, label, footer, onCancel }) => {
  useAppInput((_input, key) => {
    if (key.escape && onCancel) onCancel()
  }, { isActive: Boolean(onCancel) })
  const resolvedFooter = footer ?? (onCancel ? <Text color={theme.dim}>esc cancels</Text> : undefined)
  return (
    <Surface title={title} subtitle={subtitle} footer={resolvedFooter}>
      <Spinner label={label} />
    </Surface>
  )
}
