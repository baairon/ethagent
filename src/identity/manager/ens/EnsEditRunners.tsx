import React from 'react'
import type { Address } from 'viem'
import { useAppInput } from '../../../app/input/AppInputProvider.js'
import type { EnsSubdomainDeletePlan } from '../../ens/ensAutomation.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import { runDeleteEnsSubdomain } from './transactions.js'
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
  recordKeys: readonly string[]
  walletSession: BrowserWalletReady | null
  onWalletReady: (session: BrowserWalletReady | null) => void
  onDeleted: () => void
  onError: (msg: string) => void
  onCancel: () => void
}> = ({ plan, ownerAddress, recordKeys, walletSession, onWalletReady, onDeleted, onError, onCancel }) => {
  const [confirming, setConfirming] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    const request = new AbortController()
    runDeleteEnsSubdomain({
      plan,
      recordKeys,
      ownerAddress,
      callbacks: {
        onStep: () => {},
        onIdentityComplete: async () => {},
        onWalletReady: ready => {
          if (cancelled) return
          onWalletReady(ready)
          setConfirming(!ready)
        },
        signal: request.signal,
      },
    })
      .then(() => {
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
    return () => {
      cancelled = true
      request.abort()
    }
  }, [])
  return (
    <WalletApprovalScreen
      title={`Delete ${plan.fullName}`}
      subtitle="Clears the agent records on the name, then removes it. Each step is one transaction on Ethereum Mainnet and needs gas."
      walletSession={confirming ? null : walletSession}
      label={confirming ? 'Confirming on Ethereum Mainnet…' : 'Waiting for your wallet…'}
      {...(confirming ? {} : { onCancel })}
    />
  )
}
