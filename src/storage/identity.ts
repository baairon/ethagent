import {
  loadConfig,
  saveConfig,
  type EthagentConfig,
  type EthagentIdentity,
} from './config.js'
import {
  getSecret,
  setSecret,
  rmSecret,
  hasSecret,
  whichBackend,
  type KeyBackend,
} from './secrets.js'
import { addressFromPrivateKey, validatePrivateKey } from '../identity/eth.js'

const IDENTITY_ACCOUNT = 'ethereum:default'

export type IdentityStatus = {
  address: string
  createdAt: string
  backend: KeyBackend
} | null

export async function getIdentityStatus(config?: EthagentConfig): Promise<IdentityStatus> {
  const resolved = config ?? (await loadConfig())
  if (!resolved?.identity) return null
  const present = await hasSecret(IDENTITY_ACCOUNT)
  if (!present) return null
  const backend = await whichBackend()
  return {
    address: resolved.identity.address,
    createdAt: resolved.identity.createdAt,
    backend,
  }
}

export async function setIdentity(
  privateKey: string,
  config: EthagentConfig,
): Promise<{ identity: EthagentIdentity; backend: KeyBackend; config: EthagentConfig }> {
  if (!validatePrivateKey(privateKey)) throw new Error('invalid private key')
  const address = addressFromPrivateKey(privateKey)
  const backend = await setSecret(IDENTITY_ACCOUNT, privateKey.trim())
  const identity: EthagentIdentity = {
    address,
    createdAt: new Date().toISOString(),
  }
  const next: EthagentConfig = { ...config, identity }
  await saveConfig(next)
  return { identity, backend, config: next }
}

export async function clearIdentity(config: EthagentConfig): Promise<EthagentConfig> {
  await rmSecret(IDENTITY_ACCOUNT)
  if (!config.identity) return config
  const { identity: _drop, ...rest } = config
  void _drop
  const next = { ...rest } as EthagentConfig
  await saveConfig(next)
  return next
}

export async function getPrivateKey(): Promise<string | null> {
  return getSecret(IDENTITY_ACCOUNT)
}

export async function hasPrivateKey(): Promise<boolean> {
  return hasSecret(IDENTITY_ACCOUNT)
}
