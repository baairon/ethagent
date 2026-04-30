import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { atomicWriteText } from './atomicWrite.js'

export const PROVIDERS = ['llamacpp', 'openai', 'anthropic', 'gemini'] as const
export type ProviderId = (typeof PROVIDERS)[number]
const LEGACY_PROVIDERS = ['ollama', ...PROVIDERS] as const

export const SELECTABLE_NETWORKS = ['mainnet', 'arbitrum', 'base', 'optimism', 'polygon'] as const
export type SelectableNetwork = (typeof SELECTABLE_NETWORKS)[number]

const IdentitySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  createdAt: z.string(),
  source: z.enum(['local-key', 'erc8004']).optional(),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
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
  }).optional(),
  publicSkills: z.object({
    cid: z.string().min(1).optional(),
    agentCardCid: z.string().min(1).optional(),
    updatedAt: z.string().optional(),
    status: z.enum(['pinned', 'failed', 'unknown']).optional(),
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
  }).optional(),
  selectedNetwork: z.enum(SELECTABLE_NETWORKS).optional(),
})

const LEGACY_OLLAMA_BASE_URL = 'http://localhost:11434/v1'
const LegacyConfigSchema = ConfigSchema.extend({
  provider: z.enum(LEGACY_PROVIDERS),
})

type LegacyConfig = z.infer<typeof LegacyConfigSchema>

export type EthagentIdentity = z.infer<typeof IdentitySchema>

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
  const validated = ConfigSchema.parse(normalizeConfig(config))
  const file = getConfigPath()
  await atomicWriteText(file, JSON.stringify(validated, null, 2) + '\n')
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
  if (config.provider !== 'llamacpp') return config
  const baseUrl = localProviderBaseUrlFor(config.provider, config.baseUrl)
  return config.baseUrl === baseUrl ? config : { ...config, baseUrl }
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
