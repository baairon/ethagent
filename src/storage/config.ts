import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { atomicWriteText } from './atomicWrite.js'

export const PROVIDERS = ['llamacpp', 'openai', 'anthropic', 'gemini'] as const
export type ProviderId = (typeof PROVIDERS)[number]
const LEGACY_PROVIDERS = ['ollama', ...PROVIDERS] as const

export const SELECTABLE_NETWORKS = ['mainnet', 'base'] as const
export type SelectableNetwork = (typeof SELECTABLE_NETWORKS)[number]

const IdentitySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  createdAt: z.string(),
  source: z.enum(['local-key', 'erc8004']).optional(),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  connectedWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  chainId: z.number().int().positive().optional(),
  rpcUrl: z.string().url().optional(),
  identityRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  agentId: z.string().min(1).optional(),
  agentUri: z.string().min(1).optional(),
  metadataCid: z.string().min(1).optional(),
  state: z.record(z.unknown()).optional(),
  backup: z.object({
    cid: z.string().min(1),
    createdAt: z.string(),
    envelopeVersion: z.string().min(1),
    ipfsApiUrl: z.string().url(),
    status: z.enum(['pinned', 'restored', 'failed', 'unknown']),
    ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    chainId: z.number().int().positive().optional(),
    rpcUrl: z.string().url().optional(),
    identityRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    agentId: z.string().min(1).optional(),
    agentUri: z.string().min(1).optional(),
    metadataCid: z.string().min(1).optional(),
    txHash: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
    transferSnapshot: z.object({
      kind: z.literal('dual-wallet'),
      senderAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      receiverAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      receiverHandle: z.string().min(1).optional(),
      slotCount: z.number().int().positive(),
      createdAt: z.string().optional(),
    }).optional(),
    pastBackups: z.array(z.object({
      cid: z.string().min(1),
      createdAt: z.string(),
    })).optional(),
  }).optional(),
  publicSkills: z.object({
    cid: z.string().min(1).optional(),
    agentCardCid: z.string().min(1).optional(),
    updatedAt: z.string().optional(),
    status: z.enum(['pinned', 'failed', 'unknown']).optional(),
  }).optional(),
  pendingTx: z.object({
    hash: z.string().regex(/^0x[a-fA-F0-9]+$/),
    kind: z.enum([
      'register',
      'rebackup-uri',
      'rebackup-uri-vault',
      'token-transfer',
      'public-profile',
      'vault-deploy',
      'vault-deposit',
      'vault-unwrap',
      'vault-withdraw',
    ]),
    chainId: z.number().int().positive(),
    submittedAt: z.string(),
  }).optional(),
})

const ConfigSchema = z.object({
  version: z.literal(1),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  firstRunAt: z.string(),
  identity: IdentitySchema.optional(),
  erc8004: z.object({
    chainId: z.number().int().positive(),
    rpcUrl: z.string().url(),
    identityRegistryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: z.string().regex(/^\d+$/).optional(),
    operatorVaults: z.record(
      z.string().regex(/^\d+$/),
      z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    ).optional(),
  }).optional(),
  selectedNetwork: z.enum(SELECTABLE_NETWORKS).optional(),
  configVersion: z.number().int().nonnegative().optional(),
})

const LEGACY_OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const LegacyConfigSchema = ConfigSchema.extend({
  provider: z.enum(LEGACY_PROVIDERS),
})

type LegacyConfig = z.infer<typeof LegacyConfigSchema>

export type EthagentIdentity = z.infer<typeof IdentitySchema>
export type TransferSnapshotMetadata = NonNullable<NonNullable<EthagentIdentity['backup']>['transferSnapshot']>

export type EthagentConfig = z.infer<typeof ConfigSchema>

export function getConfigDir(): string {
  return path.join(os.homedir(), '.ethagent')
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true })
}

export async function loadConfig(): Promise<EthagentConfig | null> {
  const file = getConfigPath()
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  try {
    const parsed = JSON.parse(raw)
    const active = ConfigSchema.safeParse(parsed)
    if (active.success) return normalizeConfig(active.data)
    const legacy = LegacyConfigSchema.safeParse(parsed)
    if (legacy.success) return migrateLegacyConfig(legacy.data)
    return null
  } catch {
    return null
  }
}

export async function saveConfig(config: EthagentConfig): Promise<void> {
  await ensureConfigDir()
  const bumped: EthagentConfig = {
    ...normalizeConfig(config),
    configVersion: (config.configVersion ?? 0) + 1,
  }
  const validated = ConfigSchema.parse(bumped)
  const file = getConfigPath()
  await atomicWriteText(file, JSON.stringify(validated, null, 2) + '\n')
}

export class ConfigVersionStaleError extends Error {
  readonly baseVersion: number | undefined
  readonly currentVersion: number | undefined
  constructor(baseVersion: number | undefined, currentVersion: number | undefined) {
    super('Config write conflict detected: another writer beat this update. Retry to merge.')
    this.name = 'ConfigVersionStaleError'
    this.baseVersion = baseVersion
    this.currentVersion = currentVersion
  }
}

export async function saveConfigGuarded(
  prev: EthagentConfig | null,
  next: EthagentConfig,
): Promise<EthagentConfig> {
  const current = await loadConfig()
  const currentVersion = current?.configVersion
  const baseVersion = prev?.configVersion
  if (currentVersion !== baseVersion) {
    throw new ConfigVersionStaleError(baseVersion, currentVersion)
  }
  const toWrite: EthagentConfig = { ...next, configVersion: currentVersion ?? 0 }
  await saveConfig(toWrite)
  return { ...toWrite, configVersion: (currentVersion ?? 0) + 1 }
}

export async function saveConfigWithMerge(
  applyPatch: (current: EthagentConfig | null) => EthagentConfig | Promise<EthagentConfig>,
  attempts: number = 3,
): Promise<EthagentConfig> {
  let lastErr: ConfigVersionStaleError | undefined
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await loadConfig()
    const next = await applyPatch(current)
    try {
      return await saveConfigGuarded(current, next)
    } catch (err: unknown) {
      if (!(err instanceof ConfigVersionStaleError)) throw err
      lastErr = err
    }
  }
  throw lastErr ?? new ConfigVersionStaleError(undefined, undefined)
}

export function getConfiguredOperatorVaultAddress(
  config: EthagentConfig | null | undefined,
  chainId: number,
): string | undefined {
  return config?.erc8004?.operatorVaults?.[String(chainId)]
}

export function buildSeedConfigForIdentity(args: {
  identity: EthagentIdentity
  chainId: number
  rpcUrl: string
  identityRegistryAddress: string
}): EthagentConfig {
  return {
    version: 1,
    provider: 'llamacpp',
    model: defaultModelFor('llamacpp'),
    firstRunAt: new Date().toISOString(),
    identity: { ...args.identity, source: 'erc8004' },
    erc8004: {
      chainId: args.chainId,
      rpcUrl: args.rpcUrl,
      identityRegistryAddress: args.identityRegistryAddress,
    },
  }
}

export function setConfiguredOperatorVaultAddress(
  config: EthagentConfig,
  chainId: number,
  vaultAddress: string,
): EthagentConfig {
  if (!config.erc8004) {
    throw new Error('Cannot record operator delegation vault address: erc8004 registry config is not set')
  }
  return {
    ...config,
    erc8004: {
      ...config.erc8004,
      operatorVaults: {
        ...(config.erc8004.operatorVaults ?? {}),
        [String(chainId)]: vaultAddress,
      },
    },
  }
}

export type PendingTxRecord = NonNullable<EthagentIdentity['pendingTx']>
export type PendingTxKind = PendingTxRecord['kind']

export async function recordPendingTx(record: PendingTxRecord): Promise<EthagentConfig | null> {
  return savePendingTxMutation(identity => ({ ...identity, pendingTx: record }))
}

export async function clearPendingTx(): Promise<EthagentConfig | null> {
  return savePendingTxMutation(identity => {
    if (!identity.pendingTx) return null
    const { pendingTx: _drop, ...identityRest } = identity
    return identityRest
  })
}

async function savePendingTxMutation(
  mutate: (identity: NonNullable<EthagentConfig['identity']>) => NonNullable<EthagentConfig['identity']> | null,
): Promise<EthagentConfig | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const config = await loadConfig()
    if (!config?.identity) return config
    const mutatedIdentity = mutate(config.identity)
    if (!mutatedIdentity) return config
    const next: EthagentConfig = { ...config, identity: mutatedIdentity }
    try {
      return await saveConfigGuarded(config, next)
    } catch (err: unknown) {
      if (!(err instanceof ConfigVersionStaleError)) throw err
      if (attempt === 1) {
        console.warn('[ethagent] pending-tx config write skipped: cross-tab conflict persisted after retry')
        return null
      }
    }
  }
  return null
}

export async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(getConfigPath())
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

export function defaultModelFor(provider: ProviderId): string {
  switch (provider) {
    case 'openai':    return 'gpt-5.2'
    case 'anthropic': return 'claude-sonnet-4-5'
    case 'gemini':    return 'gemini-2.0-flash'
    case 'llamacpp':  return 'huggingface-link'
  }
}

export function defaultBaseUrlFor(provider: ProviderId): string | undefined {
  if (provider === 'llamacpp') return 'http://localhost:8080/v1'
  return undefined
}

export type LocalProviderId = Extract<ProviderId, 'llamacpp'>

export function localProviderBaseUrlFor(provider: LocalProviderId, baseUrl?: string): string {
  const fallback = defaultBaseUrlFor(provider) ?? ''
  if (!baseUrl) return fallback
  return isDefaultBaseUrlFor(baseUrl, LEGACY_OLLAMA_BASE_URL) ? fallback : baseUrl
}

export function normalizeConfig(config: EthagentConfig): EthagentConfig {
  let next = config
  if (next.provider === 'llamacpp') {
    const baseUrl = localProviderBaseUrlFor(next.provider, next.baseUrl)
    if (next.baseUrl !== baseUrl) next = { ...next, baseUrl }
  }
  if (!next.erc8004 && next.identity?.chainId && next.identity.identityRegistryAddress && next.identity.rpcUrl) {
    next = {
      ...next,
      erc8004: {
        chainId: next.identity.chainId,
        rpcUrl: next.identity.rpcUrl,
        identityRegistryAddress: next.identity.identityRegistryAddress,
      },
    }
  }
  return next
}

function migrateLegacyConfig(config: LegacyConfig): EthagentConfig {
  if (config.provider !== 'ollama') return normalizeConfig(ConfigSchema.parse(config))
  return {
    ...config,
    provider: 'llamacpp',
    model: defaultModelFor('llamacpp'),
    baseUrl: defaultBaseUrlFor('llamacpp'),
  }
}

function isDefaultBaseUrlFor(value: string, fallback: string | undefined): boolean {
  if (!fallback) return false
  try {
    const url = new URL(value)
    const defaultUrl = new URL(fallback)
    if (url.protocol !== defaultUrl.protocol) return false
    if (url.hostname.toLowerCase() !== defaultUrl.hostname.toLowerCase()) return false
    if (effectivePort(url) !== effectivePort(defaultUrl)) return false
    const path = stripTrailingSlash(url.pathname) || '/'
    const defaultPath = stripTrailingSlash(defaultUrl.pathname) || '/'
    return path === '/' || path === defaultPath
  } catch {
    return stripTrailingSlash(value) === stripTrailingSlash(fallback)
  }
}

function effectivePort(url: URL): string {
  if (url.port) return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
