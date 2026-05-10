import type { WalletConfig } from './types.js'

export const config: WalletConfig =
  (window.__WALLET_CONFIG__ as WalletConfig) || {
    sessionToken: 'preview',
    kind: 'sign',
    chainIdHex: '0xaa36a7',
    message: 'identity proof for 0x9F2a???BC4e',
  }
