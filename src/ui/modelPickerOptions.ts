import { defaultModelFor, type ProviderId } from '../storage/config.js'
import { type ModelCatalogEntry, type ModelCatalogResult } from '../models/catalog.js'
import { type SelectOption } from './Select.js'

export type CloudProviderId = Exclude<ProviderId, 'ollama'>

export const MODEL_PICKER_CLOUD_PROVIDERS: CloudProviderId[] = ['openai', 'anthropic', 'gemini']

export type ModelPickerOptionsData = {
  daemonUp: boolean
  daemonError?: string
  models: Array<{ name: string; sizeBytes: number }>
  cloudKeys: Partial<Record<ProviderId, boolean>>
  cloudCatalogs: Partial<Record<ProviderId, ModelCatalogResult>>
}

export type ModelPickerOptionsContext = {
  currentProvider: ProviderId
  currentModel: string
}

const CURATED_CLOUD_MODEL_LIMIT = 3
const PROVIDER_INDENT = 2
const CHILD_INDENT = 4

export function buildModelPickerOptions(
  data: ModelPickerOptionsData,
  context: ModelPickerOptionsContext,
): SelectOption<string>[] {
  const options: SelectOption<string>[] = []

  options.push(sectionOption('hdr:local', 'local / ollama'))
  if (!data.daemonUp) {
    options.push(noticeOption('hdr:local-off', data.daemonError ?? 'daemon not running'))
  } else if (data.models.length === 0) {
    options.push(noticeOption('hdr:no-models', 'no models installed - pull one with /pull <name>'))
  } else {
    for (const m of data.models) {
      const active = context.currentProvider === 'ollama' && m.name === context.currentModel
      const size = formatSize(m.sizeBytes)
      options.push(rowOption(`ol:${m.name}`, `${active ? '* ' : '  '}${m.name}${size ? ` · ${size}` : ''}`))
    }
  }

  options.push(sectionOption('hdr:cloud', 'cloud'))
  for (const provider of MODEL_PICKER_CLOUD_PROVIDERS) {
    options.push(groupOption(`hdr:cloud:${provider}`, provider))
    const keySet = data.cloudKeys[provider] === true
    if (!keySet) {
      options.push(utilityOption(`key:set:${provider}`, 'api key · add'))
      continue
    }

    const catalog = data.cloudCatalogs[provider]
    if (catalog?.status === 'fallback') {
      const reason = catalog.error ? ` - ${catalog.error}` : ''
      options.push(noticeOption(
        `hdr:cloud-fallback:${provider}`,
        `catalog unavailable${reason} - showing configured model`,
        CHILD_INDENT,
      ))
    }

    const models = cloudPickerModels(provider, catalog, context)
    if (models.length === 0) {
      options.push(noticeOption(`hdr:cloud-empty:${provider}`, 'no selectable models', CHILD_INDENT))
    }
    for (const model of models) {
      const active = context.currentProvider === provider && context.currentModel === model
      options.push(rowOption(
        `c:${provider}:${model}`,
        `${model}${active ? '  *' : ''}`,
      ))
    }
    options.push(utilityOption(`catalog:${provider}`, 'full catalog'))
    options.push(utilityOption(`key:manage:${provider}`, 'api key · manage'))
  }

  return options
}

export function cloudPickerModels(
  provider: CloudProviderId,
  catalog: ModelCatalogResult | undefined,
  _context: ModelPickerOptionsContext,
): string[] {
  const entries = catalog?.entries ?? []
  const discovered = catalog?.status === 'ok'
    ? curateDiscoveredCloudEntries(provider, entries).map(entry => entry.id)
    : entries.map(entry => entry.id)
  const models = dedupeStrings(discovered)

  if (catalog?.status !== 'ok' && entries.length === 0) {
    appendUnique(models, defaultModelFor(provider))
  }

  return models
}

export function curateDiscoveredCloudEntries(
  provider: CloudProviderId,
  entries: ModelCatalogEntry[],
): ModelCatalogEntry[] {
  const unique = dedupeEntries(entries)
  const eligible = unique.filter(entry => isCuratedModelCandidate(provider, entry.id))
  return rankEntriesByRecency(eligible).slice(0, CURATED_CLOUD_MODEL_LIMIT).map(item => item.entry)
}

function sectionOption(value: string, label: string): SelectOption<string> {
  return {
    value,
    label,
    disabled: true,
    role: 'section',
    bold: true,
  }
}

function groupOption(value: string, label: string): SelectOption<string> {
  return {
    value,
    label,
    disabled: true,
    role: 'group',
    bold: true,
    indent: PROVIDER_INDENT,
  }
}

function noticeOption(value: string, label: string, indent = 0): SelectOption<string> {
  return {
    value,
    label,
    disabled: true,
    role: 'notice',
    prefix: 'note',
    indent,
  }
}

function rowOption(value: string, label: string): SelectOption<string> {
  return {
    value,
    label,
    role: 'option',
    indent: CHILD_INDENT,
  }
}

function utilityOption(value: string, label: string): SelectOption<string> {
  return {
    value,
    label,
    role: 'utility',
    indent: CHILD_INDENT,
  }
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

type RankedEntry = {
  entry: ModelCatalogEntry
  score: number
  index: number
}

function rankEntriesByRecency(entries: ModelCatalogEntry[]): RankedEntry[] {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: recencyScore(entry.id),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
}

function recencyScore(id: string): number {
  return dateScore(id) || versionScore(id)
}

function dateScore(id: string): number {
  const iso = id.match(/(?:^|[-_])(\d{4})[-_](\d{2})[-_](\d{2})(?=$|[-_])/)
  if (iso) return Number(`${iso[1]}${iso[2]}${iso[3]}`)
  const compact = id.match(/(?:^|[-_])(\d{8})(?=$|[-_])/)
  if (compact) return Number(compact[1])
  const monthYear = id.match(/(?:^|[-_])(\d{1,2})[-_](\d{4})(?=$|[-_])/)
  if (monthYear) return Number(`${monthYear[2]}${monthYear[1]?.padStart(2, '0')}00`)
  return 0
}

function versionScore(id: string): number {
  const match = id.match(/(?:^|[-_])(\d+(?:[.-]\d+){0,3})(?=$|[-_])/)
  if (!match) return 0
  const version = match[1]
  if (!version) return 0
  return version
    .split(/[.-]/)
    .slice(0, 4)
    .reduce((score, part, index) => {
      const value = Number.parseInt(part, 10)
      if (!Number.isFinite(value)) return score
      return score + value * Math.pow(100, 3 - index)
    }, 0)
}

const CURATED_EXCLUDED_TOKENS = [
  'alpha',
  'beta',
  'deep-research',
  'dev',
  'experimental',
  'preview',
  'test',
] as const

function isCuratedModelCandidate(provider: CloudProviderId, id: string): boolean {
  const lower = id.toLowerCase()
  if (provider === 'gemini' && !lower.startsWith('gemini-')) return false
  return !CURATED_EXCLUDED_TOKENS.some(token => hasToken(lower, token))
}

function hasToken(id: string, token: string): boolean {
  return new RegExp(`(^|[-_.])${escapeRegExp(token)}($|[-_.])`).test(id)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}
