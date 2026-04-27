import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Spinner } from '../../ui/Spinner.js'
import { theme } from '../../ui/theme.js'
import { useAppInput } from '../../input/AppInputProvider.js'
import type { BrowserWalletReady } from '../browserWallet.js'

type WalletApprovalScreenProps = {
  title: string
  subtitle: string
  walletSession: BrowserWalletReady | null
  label: string
  onCancel?: () => void
}

export const WalletApprovalScreen: React.FC<WalletApprovalScreenProps> = ({ title, subtitle, walletSession, label, onCancel }) => {
  useAppInput((_input, key) => {
    if (key.escape && onCancel) onCancel()
  }, { isActive: Boolean(onCancel) })
  const footer = onCancel ? <Text color={theme.dim}>esc cancels</Text> : undefined
  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      {walletSession ? (
        <Box flexDirection="column">
          <Text color={theme.dim}>open this approval page</Text>
          <Text color={theme.accentPrimary}>{walletSession.url}</Text>
          <Box marginTop={1}>
            <Spinner label={label} />
          </Box>
        </Box>
      ) : (
        <Spinner label="preparing wallet approval..." />
      )}
    </Surface>
  )
}
