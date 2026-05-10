export interface WalletTx {
  to?: string
  data: string
  value?: string
  gas?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}

export interface WalletConfig {
  sessionToken: string
  kind: 'account' | 'sign' | 'sign-transaction' | 'transaction' | 'session-wait'
  purpose?: string
  flowId?: string
  flowStep?: number
  tokenChainName?: string
  chainIdHex?: string
  message?: string
  expectedAccount?: string
  tx?: WalletTx
  [k: string]: unknown
}

export interface WalletErrorPayload {
  message?: string
  code?: string
  data?: string
  causes?: string[]
  method?: string
  purpose?: string
  chainIdHex?: string
  title?: string
}

declare global {
  interface Window {
    __WALLET_CONFIG__?: WalletConfig
    __WALLET_PREVIEW__?: boolean
    __walletPreview?: {
      setState: (state: string, payload?: unknown) => void
      setConfig: (c: Partial<WalletConfig>) => void
      showChromeConnect?: () => void
      hideChromeConnect?: () => void
    }
    ethereum?: unknown
  }
}
