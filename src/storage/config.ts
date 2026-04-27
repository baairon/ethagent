import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { atomicWriteText } from './atomicWrite.js'

export const PROVIDERS = ['ollama', 'openai', 'anthropic', 'gemini'] as const
export type ProviderId = (typeof PROVIDERS)[number]

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
    return ConfigSchema.parse(parsed)
  } catch {
    return null
  }
}

export async function saveConfig(config: EthagentConfig): Promise<void> {
  await ensureConfigDir()
  const validated = ConfigSchema.parse(config)
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
    case 'ollama':    return 'qwen2.5-coder:7b'
  }
}

export function defaultBaseUrlFor(provider: ProviderId): string | undefined {
  if (provider === 'ollama') return 'http://localhost:11434/v1'
  return undefined
}
