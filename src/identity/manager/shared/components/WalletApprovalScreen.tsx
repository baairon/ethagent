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

export const OPEN_BROWSER_HINT = 'Press ↵ to open the approval page in your browser.'

export const WalletApprovalScreen: React.FC<WalletApprovalScreenProps> = ({ title, subtitle, walletSession, label, onCancel }) => {
  useAppInput((input, key) => {
    if ((key.escape || (key.ctrl && input === 'c')) && onCancel) onCancel()
    if (key.return && walletSession?.url) {
      openExternalUrl(walletSession.url)
    }
  }, { isActive: Boolean(onCancel) || Boolean(walletSession) })
  const footer = onCancel ? <Text color={theme.dim}>esc cancel</Text> : undefined
  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      <Spinner label={label} />
      {walletSession ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.textSubtle}>{OPEN_BROWSER_HINT}</Text>
          <Text color={theme.accentBlue} underline>{walletSession.url}</Text>
        </Box>
      ) : null}
    </Surface>
  )
}
