import type { Address, Hex, PublicClient } from 'viem'

export type ReadyHandler = (session: BrowserWalletReady) => void

export type BrowserWalletReady = {
  url: string
}

export type WalletPurpose =
  | 'connect-operator-wallet'
  | 'create-agent'
  | 'restore-owner-wallet'
  | 'restore-operator-wallet'
  | 'update-snapshot-owner'
  | 'update-snapshot-operator'
  | 'update-snapshot-connected'
  | 'update-ens'
  | 'clear-ens'
  | 'update-profile-owner'
  | 'update-profile-operator'
  | 'update-profile-connected'
  | 'update-ens-records'
  | 'clear-ens-records'
  | 'create-simple-ens-subdomain'
  | 'set-simple-ens-records'
  | 'create-agent-ens-subdomain'
  | 'set-agent-ens-records'
  | 'update-operators'
  | 'operator-proof'
  | 'sync-operator-vault'
  | 'refetch-snapshot'
  | 'prepare-transfer-sender'
  | 'prepare-transfer-target'
  | 'publish-transfer-snapshot'
  | 'deploy-agent-vault'
  | 'deposit-agent-vault'
  | 'unwrap-agent-vault'
  | 'rotate-agent-uri-vault-owner'
  | 'rotate-agent-uri-vault-operator'
  | 'withdraw-vault'
  | 'delete-ens-subdomain'

export type SignatureRequest = {
  chainId: number
  expectedAccount?: Address
  message?: string
  messageForAccount?: (account: Address) => string
  timeoutMs?: number
  onReady?: ReadyHandler
  purpose?: WalletPurpose
  flowId?: string
  flowStep?: number
  tokenChainName?: string
}

export type TransactionRequest = {
  chainId: number
  expectedAccount: Address
  to?: Address
  data: Hex
  value?: Hex
  gas?: Hex
  maxFeePerGas?: Hex
  maxPriorityFeePerGas?: Hex
  timeoutMs?: number
  onReady?: ReadyHandler
  purpose?: WalletPurpose
  flowId?: string
  flowStep?: number
  tokenChainName?: string
}

export type SignAndTransactionRequest<TPrepared> = {
  chainId: number
  expectedAccount?: Address
  message?: string
  messageForAccount?: (account: Address) => string
  timeoutMs?: number
  onReady?: ReadyHandler
  purpose?: WalletPurpose
  flowId?: string
  flowStep?: number
  tokenChainName?: string
  prepareTransaction: (wallet: BrowserWalletSignature) => Promise<{
    to: Address
    data: Hex
    value?: Hex
    gas?: Hex
    maxFeePerGas?: Hex
    maxPriorityFeePerGas?: Hex
    prepared: TPrepared
  }>
}

export type AccountRequest = {
  timeoutMs?: number
  onReady?: ReadyHandler
  purpose?: WalletPurpose
  flowId?: string
  flowStep?: number
  tokenChainName?: string
}

export type BrowserWalletErrorPayload = {
  message: string
  code?: string
  data?: string
  causes?: readonly string[]
  method?: string
  purpose?: string
  chainIdHex?: string
  title?: string
}

export class BrowserWalletError extends Error {
  readonly code?: string
  readonly data?: string
  readonly causes: readonly string[]
  readonly method?: string
  readonly purpose?: string
  readonly chainIdHex?: string
  readonly title?: string
  constructor(payload: BrowserWalletErrorPayload) {
    super(payload.message || 'Wallet request failed')
    this.name = 'BrowserWalletError'
    if (payload.code !== undefined) this.code = payload.code
    if (payload.data !== undefined) this.data = payload.data
    this.causes = payload.causes ?? []
    if (payload.method !== undefined) this.method = payload.method
    if (payload.purpose !== undefined) this.purpose = payload.purpose
    if (payload.chainIdHex !== undefined) this.chainIdHex = payload.chainIdHex
    if (payload.title !== undefined) this.title = payload.title
  }
}

export type PrepareTransactionGasFeeClient = Pick<PublicClient, 'estimateGas' | 'estimateFeesPerGas'>

export type PrepareTransactionGasFeeArgs = {
  client: PrepareTransactionGasFeeClient
  account: Address
  to?: Address
  data: Hex
  value?: bigint
}

export type PreparedGasFee = {
  gas: Hex
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
}

export type BrowserWalletSignature = {
  account: Address
  message: string
  signature: Hex
}

export type BrowserWalletTransaction = {
  account: Address
  txHash: Hex
}

export type BrowserWalletSignAndTransaction<TPrepared> = BrowserWalletSignature & {
  txHash: Hex
  prepared: TPrepared
}

export type BrowserWalletAccount = {
  account: Address
}

export type BrowserWalletSession = {
  url: string
  requestSignature: (req: SignatureRequest) => Promise<BrowserWalletSignature>
  sendTransaction: (req: TransactionRequest) => Promise<BrowserWalletTransaction>
  requestSignatureAndTransaction: <TPrepared>(
    req: SignAndTransactionRequest<TPrepared>,
  ) => Promise<BrowserWalletSignAndTransaction<TPrepared>>
  close: () => Promise<void>
}

export type PendingPrompt = {
  sessionToken: string
  payload: Record<string, unknown>
  prepare?: (body: Record<string, unknown>) => Record<string, unknown>
  prepareTransaction?: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  resolve: (body: Record<string, unknown>) => void
  reject: (err: unknown) => void
  timeout: NodeJS.Timeout
}
