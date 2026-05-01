import React from 'react'
import { Box, Text } from 'ink'
import { exec } from 'node:child_process'
import { Surface } from '../../../ui/Surface.js'
import { Spinner } from '../../../ui/Spinner.js'
import { theme } from '../../../ui/theme.js'
import { useAppInput } from '../../../app/input/AppInputProvider.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'

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
    if (key.return && walletSession?.url) {
      const command = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      exec(`${command} "${walletSession.url}"`).on('error', () => {})
    }
  }, { isActive: Boolean(onCancel) || Boolean(walletSession) })
  const footer = onCancel ? <Text color={theme.dim}>esc cancels</Text> : undefined
  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      {walletSession ? (
        <Box flexDirection="column">
          <Text color={theme.dim}>open this approval page</Text>
          <Text color={theme.accentPrimary}>{walletSession.url}</Text>
          <Text color={theme.dim}>press enter to open in browser...</Text>
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
