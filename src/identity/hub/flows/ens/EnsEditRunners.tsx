import React from 'react'
import { Box, Text } from 'ink'
import type { Address } from 'viem'
import { mainnet } from 'viem/chains'
import { Surface } from '../../../../ui/Surface.js'
import { useAppInput } from '../../../../app/input/AppInputProvider.js'
import {
  createMainnetClient,
} from '../../../ens/ensLookup.js'
import {
  buildCommitment,
  encodeCommitTransaction,
  encodeRegisterTransaction,
  MIN_COMMIT_AGE_SECONDS,
  ONE_YEAR_SECONDS,
} from '../../../ens/ensRegistration.js'
import type { EnsSubdomainDeletePlan } from '../../../ens/ensAutomation.js'
import {
  sendBrowserWalletTransaction,
  type BrowserWalletReady,
} from '../../../wallet/browserWallet.js'
import { WalletApprovalScreen } from '../../components/WalletApprovalScreen.js'
import { footerHint } from './EnsEditShared.js'
import type { RegisterCommitPhase } from './ensEditTypes.js'
import { theme } from '../../../../ui/theme.js'

export const EscCancel: React.FC<{ onCancel: () => void }> = ({ onCancel }) => {
  useAppInput((_input, key) => {
    if (key.escape) onCancel()
  })
  return null
}

export const RegisterRootCommitRunner: React.FC<{
  phase: RegisterCommitPhase
  ownerAddress: Address
  walletSession: BrowserWalletReady | null
  onWalletReady: (session: BrowserWalletReady | null) => void
  onCommitted: () => void
  onError: (msg: string) => void
}> = ({ phase, ownerAddress, walletSession, onWalletReady, onCommitted, onError }) => {
  const startedRef = React.useRef(false)
  React.useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const built = buildCommitment({ label: phase.label, owner: ownerAddress, durationSeconds: BigInt(ONE_YEAR_SECONDS), secret: phase.secret })
    const tx = encodeCommitTransaction(built.commitment)
    sendBrowserWalletTransaction({
      chainId: mainnet.id,
      expectedAccount: ownerAddress,
      to: tx.to,
      data: tx.data,
      purpose: 'register-root-commit',
      onReady: ready => onWalletReady(ready),
    })
      .then(async result => {
        onWalletReady(null)
        const client = createMainnetClient()
        await client.waitForTransactionReceipt({ hash: result.txHash })
        onCommitted()
      })
      .catch((err: unknown) => {
        onWalletReady(null)
        onError(err instanceof Error ? err.message : String(err))
      })
  }, [])
  return (
    <WalletApprovalScreen
      title="Commit ENS Name"
      subtitle={`Submitting the first of two transactions for ${phase.label}.eth on Ethereum mainnet. Wait for confirmation.`}
      walletSession={walletSession}
      label="waiting for connected wallet transaction..."
      onCancel={() => onError('Commit cancelled. Restart from the name input.')}
    />
  )
}

export const RegisterRootWaitScreen: React.FC<{
  phase: RegisterCommitPhase & { commitMinedAt: number }
  onReady: () => void
  onCancel: () => void
}> = ({ phase, onReady, onCancel }) => {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 500)
    return () => clearInterval(interval)
  }, [])
  const elapsedSec = Math.floor((Date.now() - phase.commitMinedAt) / 1000)
  const remaining = Math.max(0, MIN_COMMIT_AGE_SECONDS + 1 - elapsedSec)
  React.useEffect(() => {
    if (remaining === 0) onReady()
  }, [remaining])
  return (
    <Surface
      title="Commit Confirmed, Waiting"
      subtitle={`Anti-frontrun delay before registering ${phase.label}.eth. ENS requires a 60-second wait between commit and register.`}
      footer={footerHint('esc cancel registration')}
    >
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text}>{remaining > 0 ? `${remaining} seconds remaining...` : 'Ready, advancing to the registration transaction...'}</Text>
        <Text color={theme.dim}>Keep this window open. The commit expires after 24 hours if you walk away.</Text>
      </Box>
      <EscCancel onCancel={onCancel} />
    </Surface>
  )
}

export const DeleteSubdomainTxRunner: React.FC<{
  plan: EnsSubdomainDeletePlan
  ownerAddress: Address
  walletSession: BrowserWalletReady | null
  onWalletReady: (session: BrowserWalletReady | null) => void
  onDeleted: () => void
  onError: (msg: string) => void
}> = ({ plan, ownerAddress, walletSession, onWalletReady, onDeleted, onError }) => {
  const startedRef = React.useRef(false)
  React.useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    sendBrowserWalletTransaction({
      chainId: mainnet.id,
      expectedAccount: ownerAddress,
      to: plan.transaction.to,
      data: plan.transaction.data,
      purpose: 'delete-ens-subdomain',
      onReady: ready => onWalletReady(ready),
    })
      .then(async result => {
        onWalletReady(null)
        const client = createMainnetClient()
        await client.waitForTransactionReceipt({ hash: result.txHash })
        onDeleted()
      })
      .catch((err: unknown) => {
        onWalletReady(null)
        onError(err instanceof Error ? err.message : String(err))
      })
  }, [])
  return (
    <WalletApprovalScreen
      title="Delete ENS Subdomain"
      subtitle={`Clearing the subnode for ${plan.fullName} at ${plan.parentName} on Ethereum mainnet.`}
      walletSession={walletSession}
      label="waiting for owner wallet transaction..."
      onCancel={() => onError('Subdomain deletion cancelled.')}
    />
  )
}

export const RegisterRootTxRunner: React.FC<{
  phase: RegisterCommitPhase
  ownerAddress: Address
  walletSession: BrowserWalletReady | null
  onWalletReady: (session: BrowserWalletReady | null) => void
  onRegistered: () => void
  onError: (msg: string) => void
}> = ({ phase, ownerAddress, walletSession, onWalletReady, onRegistered, onError }) => {
  const startedRef = React.useRef(false)
  React.useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const tx = encodeRegisterTransaction({
      label: phase.label,
      owner: ownerAddress,
      durationSeconds: BigInt(ONE_YEAR_SECONDS),
      secret: phase.secret,
      rentPrice: phase.price,
    })
    sendBrowserWalletTransaction({
      chainId: mainnet.id,
      expectedAccount: ownerAddress,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      purpose: 'register-root-tx',
      onReady: ready => onWalletReady(ready),
    })
      .then(async result => {
        onWalletReady(null)
        const client = createMainnetClient()
        await client.waitForTransactionReceipt({ hash: result.txHash })
        onRegistered()
      })
      .catch((err: unknown) => {
        onWalletReady(null)
        onError(err instanceof Error ? err.message : String(err))
      })
  }, [])
  return (
    <WalletApprovalScreen
      title="Register ENS Name"
      subtitle={`Paying 1 year of rent and registering ${phase.label}.eth on Ethereum mainnet.`}
      walletSession={walletSession}
      label="waiting for connected wallet transaction..."
      onCancel={() => onError('Registration cancelled. The commit will expire in 24 hours; restart from the name input to retry.')}
    />
  )
}
