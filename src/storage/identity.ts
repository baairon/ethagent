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
  backend: KeyBackend | 'browser-wallet'
  backup?: EthagentIdentity['backup']
  source?: EthagentIdentity['source']
  agentId?: string
} | null

export async function getIdentityStatus(config?: EthagentConfig): Promise<IdentityStatus> {
  const resolved = config ?? (await loadConfig())
  if (!resolved?.identity) return null
  if (resolved.identity.source === 'erc8004' || resolved.identity.agentId) {
    return {
      address: resolved.identity.address,
      createdAt: resolved.identity.createdAt,
      backend: 'browser-wallet',
      backup: resolved.identity.backup,
      source: resolved.identity.source,
      agentId: resolved.identity.agentId,
    }
  }
  const present = await hasSecret(IDENTITY_ACCOUNT)
  if (!present) return null
  const backend = await whichBackend()
  return {
    address: resolved.identity.address,
    createdAt: resolved.identity.createdAt,
    backend,
    backup: resolved.identity.backup,
    source: resolved.identity.source,
  }
}

export async function setIdentity(
  privateKey: string,
  config: EthagentConfig,
  options: { backup?: EthagentIdentity['backup']; createdAt?: string } = {},
): Promise<{ identity: EthagentIdentity; backend: KeyBackend; config: EthagentConfig }> {
  if (!validatePrivateKey(privateKey)) throw new Error('invalid private key')
  const address = addressFromPrivateKey(privateKey)
  const backend = await setSecret(IDENTITY_ACCOUNT, privateKey.trim())
  const identity: EthagentIdentity = {
    address,
    createdAt: options.createdAt ?? new Date().toISOString(),
    source: 'local-key',
    ...(options.backup ? { backup: options.backup } : {}),
  }
  const next: EthagentConfig = { ...config, identity }
  await saveConfig(next)
  return { identity, backend, config: next }
}

export async function setTokenIdentity(
  config: EthagentConfig,
  identity: EthagentIdentity,
): Promise<EthagentConfig> {
  if (!identity.address || !identity.agentId || !identity.agentUri || !identity.ownerAddress) {
    throw new Error('token identity is missing ERC-8004 metadata')
  }
  const next: EthagentConfig = {
    ...config,
    identity: {
      ...identity,
      source: 'erc8004',
    },
  }
  await saveConfig(next)
  return next
}

export async function updateIdentityBackup(
  config: EthagentConfig,
  backup: NonNullable<EthagentIdentity['backup']>,
): Promise<EthagentConfig> {
  if (!config.identity) throw new Error('no identity set')
  const next: EthagentConfig = {
    ...config,
    identity: {
      ...config.identity,
      backup,
    },
  }
  await saveConfig(next)
  return next
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
