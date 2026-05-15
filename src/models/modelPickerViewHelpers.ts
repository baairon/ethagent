import type { SelectOption } from '../ui/Select.js'
import type { ProviderId } from '../storage/config.js'
import { defaultModelFor, type EthagentConfig } from '../storage/config.js'
import type { LlamaCppInstallResult } from './llamacpp.js'
import { orderGgufFilesForSpec, type GgufMachineFit } from './modelRecommendation.js'
import {
  localModelId,
  type HuggingFaceRepoInfo,
  type HuggingFaceSibling,
} from './huggingface.js'
import {
  MODEL_PICKER_CLOUD_PROVIDERS,
  orderModelsForContextFit,
  type CloudProviderId,
  type ModelPickerContextFit,
} from './modelPickerOptions.js'
import { formatModelDisplayName } from './modelDisplay.js'
import { contextFitLabel, formatBytes, modelMetadataSubtext } from './modelPickerDisplay.js'
import type { LoadedModelPickerData as LoadedData, ModelPickerSelection } from './modelPickerTypes.js'
import type { ModelCatalogResult } from './catalog.js'
import type { SpecSnapshot } from './runtimeDetection.js'

export function buildCatalogOptions(
  provider: CloudProviderId,
  catalog: ModelCatalogResult | undefined,
  currentProvider: ProviderId,
  currentModel: string,
  contextFit?: ModelPickerContextFit | null,
): SelectOption<string>[] {
  if (!catalog || catalog.entries.length === 0) {
    return [{
      value: `hdr:catalog-empty:${provider}`,
      label: 'No Models Found',
      disabled: true,
      role: 'notice',
      prefix: 'note',
    }]
  }
  const sourceById = new Map(catalog.entries.map(entry => [entry.id, entry.source]))
  return orderModelsForContextFit(provider, catalog.entries.map(entry => entry.id), contextFit).map(id => {
    const active = currentProvider === provider && currentModel === id
    const suffix = sourceById.get(id) === 'fallback' ? '  fallback' : ''
    const displayName = formatModelDisplayName(provider, id, { maxLength: 64 })
    return {
      value: `full:${provider}:${id}`,
      label: contextFitLabel(provider, id, `${displayName}${active ? '  *' : ''}${suffix}`, contextFit),
      role: 'option',
    }
  })
}

export function parseCloudValue(value: string): { provider: CloudProviderId; model: string } | null {
  if (!value.startsWith('c:')) return null
  const rest = value.slice(2)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  const provider = rest.slice(0, sep)
  const model = rest.slice(sep + 1)
  if (!isCloudProvider(provider) || !model) return null
  return { provider, model }
}

export function localModelOptionIndex(
  options: SelectOption<string>[],
  currentProvider: ProviderId,
  currentModel: string,
): number {
  return options.findIndex(opt => {
    if (opt.disabled) return false
    if (opt.value.startsWith('hf:')) return opt.value.slice(3) === currentModel && currentProvider === 'llamacpp'
    if (opt.value.startsWith('uc:')) return opt.value.slice(3) === currentModel && currentProvider === 'llamacpp'
    return false
  })
}

export function localOrCloudOptionIndex(
  options: SelectOption<string>[],
  currentProvider: ProviderId,
  currentModel: string,
): number {
  return options.findIndex(opt => {
    if (opt.disabled) return false
    if (opt.value.startsWith('hf:')) return opt.value.slice(3) === currentModel && currentProvider === 'llamacpp'
    if (opt.value.startsWith('uc:')) return opt.value.slice(3) === currentModel && currentProvider === 'llamacpp'
    const cloud = parseCloudValue(opt.value)
    return cloud?.provider === currentProvider && cloud.model === currentModel
  })
}

export function parseFullCatalogValue(value: string): { provider: CloudProviderId; model: string } | null {
  if (!value.startsWith('full:')) return null
  const rest = value.slice(5)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  const provider = rest.slice(0, sep)
  const model = rest.slice(sep + 1)
  if (!isCloudProvider(provider) || !model) return null
  return { provider, model }
}

export function parseKeyValue(value: string): { action: 'set' | 'edit' | 'manage'; provider: CloudProviderId } | null {
  if (!value.startsWith('key:')) return null
  const parts = value.split(':')
  if (parts.length !== 3) return null
  const action = parts[1]
  const provider = parts[2]
  if (action !== 'set' && action !== 'edit' && action !== 'manage') return null
  if (!provider) return null
  if (!isCloudProvider(provider)) return null
  return { action, provider }
}

export function pickFallbackSelection(data: LoadedData, removed: ProviderId): ModelPickerSelection | null {
  for (const provider of MODEL_PICKER_CLOUD_PROVIDERS) {
    if (provider === removed) continue
    if (data.cloudKeys[provider] !== true) continue
    const catalogModel = data.cloudCatalogs[provider]?.entries[0]?.id
    const model = catalogModel ?? defaultModelFor(provider)
    return { kind: 'cloud', provider, model, keyJustSet: false }
  }
  if (data.hfModels.length > 0) {
    return { kind: 'llamacpp', model: data.hfModels[0]!.id }
  }
  return null
}

export function configForProvider(config: EthagentConfig, provider: CloudProviderId): EthagentConfig {
  return {
    ...config,
    provider,
    model: config.provider === provider ? config.model : defaultModelFor(provider),
    baseUrl: provider === 'openai' && config.provider === 'openai' ? config.baseUrl : undefined,
  }
}

export function buildHfFileOptions(
  repo: HuggingFaceRepoInfo,
  files: HuggingFaceSibling[],
  spec: SpecSnapshot | undefined,
  installedModelIds: string[] = [],
): SelectOption<string>[] {
  const ordered = spec
    ? orderGgufFilesForSpec(repo, files, spec)
    : files.map(file => ({ file, fit: 'unknown' as GgufMachineFit, score: 0, budgetBytes: 0 }))
  const recommended = spec ? ordered[0]?.file.filename : undefined
  const installed = new Set(installedModelIds)
  return ordered.map(item => {
    const size = item.file.sizeBytes ? formatBytes(item.file.sizeBytes) : ''
    const indicators = [
      item.file.filename === recommended ? 'Recommended' : '',
      installed.has(localModelId(repo.repoId, item.file.filename)) ? 'Installed' : '',
    ]
    return {
      value: item.file.filename,
      label: item.file.filename,
      subtext: modelMetadataSubtext(size, indicators),
      role: 'option' as const,
    }
  })
}

export function buildRunnerRecoveryOptions(
  _result: Extract<LlamaCppInstallResult, { ok: false }>,
): SelectOption<'stop-and-retry' | 'path' | 'back'>[] {
  return [
    { value: 'stop-and-retry', label: 'Stop and Retry', hint: 'Stop background runners and try the install again' },
    { value: 'path', label: 'Use Existing Runner Path' },
    { value: 'back', label: 'Back To Picker' },
  ]
}

function isCloudProvider(value: string): value is CloudProviderId {
  return MODEL_PICKER_CLOUD_PROVIDERS.includes(value as CloudProviderId)
}
