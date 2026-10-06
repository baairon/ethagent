import React from 'react'
import type { Address } from 'viem'
import { mainnet } from 'viem/chains'
import { useAppInput } from '../../../app/input/AppInputProvider.js'
import {
  createMainnetClient,
} from '../../ens/ensLookup.js'
import type { EnsSubdomainDeletePlan } from '../../ens/ensAutomation.js'
import {
  sendBrowserWalletTransaction,
  type BrowserWalletReady,
} from '../../wallet/browserWallet.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import { isWalletCancelled } from '../shared/utils.js'

export const EscCancel: React.FC<{ onCancel: () => void }> = ({ onCancel }) => {
  useAppInput((_input, key) => {
    if (key.escape) onCancel()
  })
  return null
}

export const DeleteSubdomainTxRunner: React.FC<{
  plan: EnsSubdomainDeletePlan
  ownerAddress: Address
  walletSession: BrowserWalletReady | null
  onWalletReady: (session: BrowserWalletReady | null) => void
  onDeleted: () => void
  onError: (msg: string) => void
  onCancel: () => void
}> = ({ plan, ownerAddress, walletSession, onWalletReady, onDeleted, onError, onCancel }) => {
  const [confirming, setConfirming] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    sendBrowserWalletTransaction({
      chainId: mainnet.id,
      expectedAccount: ownerAddress,
      to: plan.transaction.to,
      data: plan.transaction.data,
      purpose: 'delete-ens-subdomain',
      onReady: ready => { if (!cancelled) onWalletReady(ready) },
    })
      .then(async result => {
        if (cancelled) return
        onWalletReady(null)
        setConfirming(true)
        await createMainnetClient().waitForTransactionReceipt({ hash: result.txHash })
        if (!cancelled) onDeleted()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        onWalletReady(null)
        if (isWalletCancelled(err)) {
          onCancel()
          return
        }
        onError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [])
  return (
    <WalletApprovalScreen
      title={`Delete ${plan.fullName}`}
      subtitle="Approve one transaction on Ethereum Mainnet. It needs gas."
      walletSession={confirming ? null : walletSession}
      label={confirming ? 'Confirming the deletion…' : 'Waiting for your wallet…'}
      {...(confirming ? {} : { onCancel })}
    />
  )
}
