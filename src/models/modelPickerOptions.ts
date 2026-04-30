import { defaultModelFor, type ProviderId } from '../storage/config.js'
import { type ModelCatalogEntry, type ModelCatalogResult } from './catalog.js'
import type { HfRisk, HfTask } from './huggingface.js'
import type { SpecSnapshot } from './runtimeDetection.js'
import { contextWindowInfo } from '../runtime/compaction.js'
import { type SelectOption } from '../ui/Select.js'
import { formatLocalHfModelDisplayName, formatModelDisplayName } from './modelDisplay.js'
import { localModelId, quantizationFromFilename } from './huggingface.js'
import type { UncensoredCatalogEntry } from './uncensoredCatalog.js'

export type CloudProviderId = Exclude<ProviderId, 'llamacpp'>

export const MODEL_PICKER_CLOUD_PROVIDERS: CloudProviderId[] = ['openai', 'anthropic', 'gemini']
export const LOCAL_MODEL_LINK_HINT = 'paste a GGUF link'
export const LOCAL_MODEL_LINK_EXAMPLE = 'e.g. https://huggingface.co/Qwen/Qwen3-8B-GGUF'

export type LocalHfPickerModel = {
  id: string
  displayName: string
  sizeBytes: number
  quantization?: string
  risk: HfRisk
  task: HfTask
  status: 'ready' | 'incomplete'
}

export type ModelPickerOptionsData = {
  llamaCpp: {
    binaryPresent: boolean
    serverUp: boolean
    error?: string
  }
  hfModels: LocalHfPickerModel[]
  machineSpec?: SpecSnapshot
  cloudKeys: Partial<Record<ProviderId, boolean>>
  cloudCatalogs: Partial<Record<ProviderId, ModelCatalogResult>>
}

export type ModelPickerContextFit = {
  usedTokens: number
  thresholdPercent?: number
}

export type ModelPickerOptionsContext = {
  currentProvider: ProviderId
  currentModel: string
  contextFit?: ModelPickerContextFit | null
}

const CURATED_CLOUD_MODEL_LIMIT = 3
const PROVIDER_INDENT = 2
const CHILD_INDENT = 4

export function buildModelPickerOptions(
  data: ModelPickerOptionsData,
  context: ModelPickerOptionsContext,
): SelectOption<string>[] {
  const options: SelectOption<string>[] = []

  options.push(sectionOption('hdr:local', 'local models'))
  appendHfModelOptions(options, data, context, 'added from links', 46)
  options.push(utilityOption('hf:download', 'add local model file', LOCAL_MODEL_LINK_HINT))
  options.push(utilityOption('local:catalog', 'view full catalog', 'from configured hugging face repo'))
  if (data.hfModels.length > 0) {
    options.push(utilityOption('local:uninstall', 'uninstall downloaded GGUF'))
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

    const models = orderModelsForContextFit(provider, cloudPickerModels(provider, catalog, context), context.contextFit)
    if (models.length === 0) {
      options.push(noticeOption(`hdr:cloud-empty:${provider}`, 'no selectable models', CHILD_INDENT))
    }
    for (const model of models) {
      const active = context.currentProvider === provider && context.currentModel === model
      const displayName = formatModelDisplayName(provider, model, { maxLength: 58 })
      options.push(rowOption(
        `c:${provider}:${model}`,
        contextFitLabel(provider, model, `${displayName}${active ? '  *' : ''}`, context.contextFit),
      ))
    }
    options.push(utilityOption(`catalog:${provider}`, 'full catalog'))
    options.push(utilityOption(`key:manage:${provider}`, 'api key · manage'))
  }

  return options
}

export function buildLocalModelCatalogOptions(
  data: ModelPickerOptionsData,
  context: ModelPickerOptionsContext,
  catalog: UncensoredCatalogEntry[] = [],
): SelectOption<string>[] {
  const options: SelectOption<string>[] = []
  options.push(sectionOption('hdr:local-catalog', 'view full catalog'))
  options.push(groupOption('hdr:uncensored:catalog', 'hugging face gguf files'))
  if (catalog.length === 0) {
    options.push(noticeOption('hdr:uncensored-empty', 'setup files unavailable; paste a GGUF link instead', CHILD_INDENT))
  } else {
    for (const entry of catalog) {
      const id = localModelId(entry.repo.repoId, entry.file.filename)
      const displayName = formatLocalHfModelDisplayName(id, {
        displayName: entry.file.filename.split('/').pop() ?? entry.file.filename,
        maxLength: 56,
      })
      const quant = quantLabel(entry.file.filename)
      options.push(rowOption(
        catalogOptionValue(entry.repo.repoId, entry.file.filename),
        displayName,
        undefined,
        modelMetadataSubtext(`${quant} · ${formatSize(entry.file.sizeBytes ?? 0)}`, [
          entry.recommended ? 'recommended for this machine' : '',
          entry.installed ? 'installed' : '',
        ]),
      ))
    }
  }

  appendHfModelOptions(options, data, context, 'downloaded GGUF', 50)
  options.push(utilityOption('hf:download', 'add local model file', LOCAL_MODEL_LINK_HINT))

  if (data.hfModels.length > 0) {
    options.push(utilityOption('local:uninstall', 'uninstall downloaded GGUF'))
  }
  return options
}

function appendHfModelOptions(
  options: SelectOption<string>[],
  data: ModelPickerOptionsData,
  context: ModelPickerOptionsContext,
  groupLabel: string,
  maxLength: number,
): void {
  options.push(groupOption('hdr:local:hf', groupLabel))
  if (data.hfModels.length === 0) {
    options.push(noticeOption('hdr:hf-empty', 'no downloaded files', CHILD_INDENT))
    return
  }

  const models = orderModelsForContextFit(
    'llamacpp',
    data.hfModels.map(model => model.id),
    context.contextFit,
  )
  const byId = new Map(data.hfModels.map(model => [model.id, model]))
  for (const id of models) {
    const model = byId.get(id)
    if (!model) continue
    const active = context.currentProvider === 'llamacpp' && id === context.currentModel
    const size = formatSize(model.sizeBytes)
    const displayName = formatLocalHfModelDisplayName(id, {
      displayName: model.displayName,
      maxLength,
    })
    options.push(rowOption(
      `hf:${id}`,
      contextFitLabel('llamacpp', id, `${active ? '* ' : '  '}${displayName}`, context.contextFit),
      undefined,
      modelMetadataSubtext(size, ['installed']),
    ))
  }
}

export function catalogOptionValue(repoId: string, filename: string): string {
  return `uc:${repoId}#${filename}`
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

export function orderModelsForContextFit(
  provider: ProviderId,
  models: string[],
  contextFit?: ModelPickerContextFit | null,
): string[] {
  if (!contextFit) return models
  return models
    .map((model, index) => ({ model, index, fit: modelContextFit(provider, model, contextFit) }))
    .sort((a, b) => {
      if (a.fit.fits !== b.fit.fits) return a.fit.fits ? -1 : 1
      return b.fit.windowTokens - a.fit.windowTokens || a.index - b.index
    })
    .map(item => item.model)
}

function contextFitLabel(
  provider: ProviderId,
  model: string,
  baseLabel: string,
  contextFit?: ModelPickerContextFit | null,
): string {
  if (!contextFit) return baseLabel
  const fit = modelContextFit(provider, model, contextFit)
  return `${baseLabel}  ${formatContextWindow(fit.windowTokens)} ctx ${fit.percent}%`
}

function modelContextFit(provider: ProviderId, model: string, contextFit: ModelPickerContextFit): {
  fits: boolean
  percent: number
  windowTokens: number
} {
  const windowTokens = contextWindowInfo(provider, model).tokens
  const percent = windowTokens > 0 ? Math.round((contextFit.usedTokens / windowTokens) * 100) : 0
  const threshold = contextFit.thresholdPercent ?? 90
  return { fits: percent < threshold, percent, windowTokens }
}

function quantLabel(filename: string): string {
  if (filename.toLowerCase().startsWith('mmproj-')) return 'Vision encoder'
  return quantizationFromFilename(filename) ?? 'GGUF'
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

function rowOption(value: string, label: string, hint?: string, subtext?: string): SelectOption<string> {
  return {
    value,
    label,
    subtext,
    hint,
    role: 'option',
    indent: CHILD_INDENT,
  }
}

function utilityOption(value: string, label: string, hint?: string): SelectOption<string> {
  return {
    value,
    label,
    hint,
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

function modelMetadataSubtext(size: string, indicators: string[]): string | undefined {
  return [size, ...indicators].filter(Boolean).join(' · ') || undefined
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return Number.isInteger(millions) ? `${millions}m` : `${millions.toFixed(1)}m`
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
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
