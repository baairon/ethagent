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
