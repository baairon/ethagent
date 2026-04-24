import { listInstalled } from '../bootstrap/ollama.js'
import { defaultModelFor, type EthagentConfig, type ProviderId } from '../storage/config.js'
import { getKey } from '../storage/secrets.js'

export type ModelCatalogSource = 'installed' | 'discovered' | 'fallback'

export type ModelCatalogEntry = {
  provider: ProviderId
  id: string
  label: string
  description?: string
  source: ModelCatalogSource
}

export type ModelCatalogResult = {
  provider: ProviderId
  entries: ModelCatalogEntry[]
  status: 'ok' | 'fallback'
  error?: string
}

type DiscoverDeps = {
  fetchImpl?: typeof fetch
  loadKey?: (provider: ProviderId) => Promise<string | null>
  listOllama?: () => Promise<Array<{ name: string; sizeBytes?: number }>>
  now?: () => number
}

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'
const CACHE_TTL_MS = 60_000

type CacheValue = {
  expiresAt: number
  entries: ModelCatalogEntry[]
}

const cache = new Map<string, CacheValue>()

export function openAIBaseUrlFor(config: Pick<EthagentConfig, 'provider' | 'baseUrl'>): string {
  return config.provider === 'openai' && config.baseUrl
    ? config.baseUrl
    : OPENAI_DEFAULT_BASE_URL
}

export function clearModelCatalogCache(): void {
  cache.clear()
}

export async function discoverProviderModels(
  config: EthagentConfig,
  deps: DiscoverDeps = {},
): Promise<ModelCatalogResult> {
  const provider = config.provider
  if (provider === 'ollama') {
    try {
      const installed = await (deps.listOllama ?? (() => listInstalled()))()
      return {
        provider,
        status: 'ok',
        entries: dedupeEntries(installed.map(model => ({
          provider,
          id: model.name,
          label: model.name,
          source: 'installed' as const,
        }))),
      }
    } catch (err: unknown) {
      return fallbackResult(config, (err as Error).message)
    }
  }

  const loadKey = deps.loadKey ?? getKey
  const apiKey = await loadKey(provider)
  if (!apiKey) return fallbackResult(config, `missing ${provider} API key`)

  const baseUrl = provider === 'openai' ? openAIBaseUrlFor(config) : ''
  const key = cacheKey(provider, baseUrl, true)
  const now = deps.now?.() ?? Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    return { provider, status: 'ok', entries: cached.entries }
  }

  try {
    const fetchImpl = deps.fetchImpl ?? fetch
    const entries =
      provider === 'openai'
        ? await discoverOpenAIModels(fetchImpl, provider, baseUrl, apiKey)
        : provider === 'anthropic'
          ? await discoverAnthropicModels(fetchImpl, apiKey)
          : await discoverGeminiModels(fetchImpl, apiKey)
    const deduped = dedupeEntries(entries)
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, entries: deduped })
    return { provider, status: 'ok', entries: deduped }
  } catch (err: unknown) {
    return fallbackResult(config, (err as Error).message)
  }
}

function fallbackResult(config: EthagentConfig, error?: string): ModelCatalogResult {
  const provider = config.provider
  return {
    provider,
    status: 'fallback',
    error,
    entries: dedupeEntries([
      {
        provider,
        id: config.model,
        label: config.model,
        source: 'fallback',
      },
      {
        provider,
        id: defaultModelFor(provider),
        label: defaultModelFor(provider),
        source: 'fallback',
      },
    ]),
  }
}

async function discoverOpenAIModels(
  fetchImpl: typeof fetch,
  provider: ProviderId,
  baseUrl: string,
  apiKey: string,
): Promise<ModelCatalogEntry[]> {
  const urls = openAIModelUrls(baseUrl)
  let lastError: Error | undefined
  for (const url of urls) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`)
        continue
      }
      const data = await response.json() as { data?: Array<{ id?: unknown }> }
      return (data.data ?? [])
        .filter(item => typeof item.id === 'string' && item.id.length > 0)
        .map(item => ({
          provider,
          id: item.id as string,
          label: item.id as string,
          source: 'discovered' as const,
        }))
    } catch (err: unknown) {
      lastError = err as Error
    }
  }
  throw lastError ?? new Error('no OpenAI model endpoint responded')
}

function openAIModelUrls(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/+$/, '')
  const fallback = normalized.endsWith('/v1')
    ? `${normalized.slice(0, -3)}/models`
    : `${normalized}/v1/models`
  return dedupeStrings([`${normalized}/models`, fallback])
}

async function discoverAnthropicModels(
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<ModelCatalogEntry[]> {
  const response = await fetchImpl('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json() as { data?: Array<{ id?: unknown; display_name?: unknown }> }
  return (data.data ?? [])
    .filter(item => typeof item.id === 'string' && item.id.length > 0)
    .map(item => ({
      provider: 'anthropic',
      id: item.id as string,
      label: typeof item.display_name === 'string' && item.display_name.length > 0
        ? item.display_name
        : item.id as string,
      source: 'discovered' as const,
    }))
}

async function discoverGeminiModels(
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<ModelCatalogEntry[]> {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json() as {
    models?: Array<{
      name?: unknown
      displayName?: unknown
      description?: unknown
      supportedGenerationMethods?: unknown
    }>
  }
  return (data.models ?? [])
    .filter(item => typeof item.name === 'string' && item.name.length > 0)
    .filter(item => Array.isArray(item.supportedGenerationMethods)
      && item.supportedGenerationMethods.includes('generateContent'))
    .map(item => {
      const id = (item.name as string).replace(/^models\//, '')
      return {
        provider: 'gemini' as const,
        id,
        label: typeof item.displayName === 'string' && item.displayName.length > 0
          ? item.displayName
          : id,
        description: typeof item.description === 'string' ? item.description : undefined,
        source: 'discovered' as const,
      }
    })
}

function cacheKey(provider: ProviderId, baseUrl: string, hasKey: boolean): string {
  return `${provider}\0${baseUrl}\0${hasKey ? 'key' : 'no-key'}`
}

function dedupeEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const seen = new Set<string>()
  const out: ModelCatalogEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
