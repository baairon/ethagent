import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Spinner } from '../../../../ui/Spinner.js'
import { theme } from '../../../../ui/theme.js'
import { useAppInput } from '../../../../app/input/AppInputProvider.js'
import { openExternalUrl } from '../../../../utils/openExternal.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'

type WalletApprovalScreenProps = {
  title: string
  subtitle: React.ReactNode
  walletSession: BrowserWalletReady | null
  label: string
  onCancel?: () => void
}

export const OPEN_BROWSER_HINT = 'Press enter to open in browser...'
const PREPARING_WALLET_REQUEST_LABEL = 'preparing wallet request...'

export const WalletApprovalScreen: React.FC<WalletApprovalScreenProps> = ({ title, subtitle, walletSession, label, onCancel }) => {
  useAppInput((_input, key) => {
    if (key.escape && onCancel) onCancel()
    if (key.return && walletSession?.url) {
      openExternalUrl(walletSession.url)
    }
  }, { isActive: Boolean(onCancel) || Boolean(walletSession) })
  const footer = onCancel ? <Text color={theme.dim}>esc cancels</Text> : undefined
  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      {walletSession ? (
        <Box flexDirection="column">
          <Text color={theme.accentBlue} underline>{walletSession.url}</Text>
          <Text color={theme.dim}>{OPEN_BROWSER_HINT}</Text>
          <Box marginTop={1}>
            <Spinner label={label} />
          </Box>
        </Box>
      ) : (
        <Spinner label={PREPARING_WALLET_REQUEST_LABEL} />
      )}
    </Surface>
  )
}
