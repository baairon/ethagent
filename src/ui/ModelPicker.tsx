import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { Select, type SelectOption } from './Select.js'
import { Spinner } from './Spinner.js'
import { TextInput } from './TextInput.js'
import { Surface } from './Surface.js'
import { listInstalled, isDaemonUp } from '../bootstrap/ollama.js'
import { hasKey, rmKey, setKey } from '../storage/secrets.js'
import { defaultModelFor, type EthagentConfig, type ProviderId } from '../storage/config.js'
import { clearModelCatalogCache, discoverProviderModels, type ModelCatalogResult } from '../models/catalog.js'
import {
  buildModelPickerOptions,
  MODEL_PICKER_CLOUD_PROVIDERS,
  type CloudProviderId,
  type ModelPickerOptionsData,
} from './modelPickerOptions.js'

export type ModelPickerSelection =
  | { kind: 'ollama'; model: string }
  | { kind: 'cloud'; provider: ProviderId; model: string; keyJustSet: boolean }

type ModelPickerProps = {
  currentConfig: EthagentConfig
  currentProvider: ProviderId
  currentModel: string
  onPick: (selection: ModelPickerSelection) => void
  onCancel: () => void
}

type LoadedData = ModelPickerOptionsData

type State =
  | { kind: 'loading' }
  | { kind: 'list'; data: LoadedData }
  | { kind: 'catalog'; provider: CloudProviderId; data: LoadedData }
  | { kind: 'keyEntry'; provider: CloudProviderId; action: 'set' | 'edit'; data: LoadedData; submitting: boolean; error?: string }
  | { kind: 'keyManage'; provider: CloudProviderId; data: LoadedData; submitting: boolean; error?: string }

export const ModelPicker: React.FC<ModelPickerProps> = ({
  currentConfig,
  currentProvider,
  currentModel,
  onPick,
  onCancel,
}) => {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [daemon, keyEntries] = await Promise.all([
        probeOllama(),
        Promise.all(MODEL_PICKER_CLOUD_PROVIDERS.map(async p => [p, await hasKey(p)] as const)),
      ])
      if (cancelled) return
      const cloudKeys = Object.fromEntries(keyEntries) as Partial<Record<ProviderId, boolean>>
      const catalogEntries = await Promise.all(
        MODEL_PICKER_CLOUD_PROVIDERS
          .filter(provider => cloudKeys[provider])
          .map(async provider => [provider, await discoverProviderModels(configForProvider(currentConfig, provider))] as const),
      )
      if (cancelled) return
      const cloudCatalogs = Object.fromEntries(catalogEntries) as Partial<Record<ProviderId, ModelCatalogResult>>
      setState({
        kind: 'list',
        data: {
          daemonUp: daemon.up,
          daemonError: daemon.error,
          models: daemon.models,
          cloudKeys,
          cloudCatalogs,
        },
      })
    })()
    return () => { cancelled = true }
  }, [currentConfig])

  if (state.kind === 'loading') {
    return (
      <Surface title="switch provider / model" subtitle="choose a provider and model.">
        <Spinner label="loading providers..." />
      </Surface>
    )
  }

  if (state.kind === 'keyEntry') {
    const { provider, action, submitting, error } = state
    return (
      <Surface
        title={`${action} ${provider} api key`}
        subtitle="stored in your os keyring when available · never written to config in plaintext."
        footer="enter saves · esc returns to picker"
      >
        {submitting ? (
          <Spinner label={`saving ${provider} key...`} />
        ) : (
          <TextInput
            label={`${provider} key`}
            placeholder={providerKeyPlaceholder(provider)}
            isSecret
            onSubmit={(value) => void submitKey(state, value, currentConfig, setState)}
            onCancel={() => setState({ kind: 'list', data: state.data })}
          />
        )}
        {error ? <Text color="#e87070">{error}</Text> : null}
      </Surface>
    )
  }

  if (state.kind === 'keyManage') {
    const { provider, submitting, error } = state
    return (
      <Surface
        title={`${provider} api key`}
        subtitle="manage the stored key for this provider."
        footer="enter selects · esc returns to picker"
      >
        {submitting ? (
          <Spinner label={`removing ${provider} key...`} />
        ) : (
          <Select
            options={[
              { value: 'edit', label: 'replace stored api key' },
              { value: 'delete', label: 'remove stored api key' },
              { value: 'cancel', label: 'back' },
            ]}
            onSubmit={(value) => {
              if (value === 'edit') {
                setState({ kind: 'keyEntry', provider, action: 'edit', data: state.data, submitting: false })
                return
              }
              if (value === 'cancel') {
                setState({ kind: 'list', data: state.data })
                return
              }
              void deleteKey(state, currentConfig, setState)
            }}
            onCancel={() => setState({ kind: 'list', data: state.data })}
          />
        )}
        {error ? <Text color="#e87070">{error}</Text> : null}
      </Surface>
    )
  }

  if (state.kind === 'catalog') {
    const catalog = state.data.cloudCatalogs[state.provider]
    const options = buildCatalogOptions(state.provider, catalog, currentProvider, currentModel)
    const initialIndex = options.findIndex(opt => {
      if (opt.disabled) return false
      const parsed = parseFullCatalogValue(opt.value)
      return parsed?.provider === currentProvider && parsed.model === currentModel
    })
    return (
      <Surface
        title={`${state.provider} full catalog`}
        subtitle="all discovered models for this provider"
        footer="enter selects · esc returns to picker"
      >
        <Select
          options={options}
          initialIndex={initialIndex === -1 ? 0 : initialIndex}
          maxVisible={12}
          onSubmit={(value) => {
            const parsed = parseFullCatalogValue(value)
            if (parsed) onPick({ kind: 'cloud', provider: parsed.provider, model: parsed.model, keyJustSet: false })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  const { data } = state
  const options = buildModelPickerOptions(data, { currentProvider, currentModel })
  const initialIndex = options.findIndex(opt => {
    if (opt.disabled) return false
    if (opt.value.startsWith('ol:')) return opt.value.slice(3) === currentModel && currentProvider === 'ollama'
    const cloud = parseCloudValue(opt.value)
    return cloud?.provider === currentProvider && cloud.model === currentModel
  })

  return (
    <Surface
      title="switch provider / model"
      subtitle="cloud providers show curated catalog choices · local ollama models are listed in full"
      footer="enter selects · esc closes · /models for full catalog"
    >
      <Select
        options={options}
        initialIndex={initialIndex === -1 ? 0 : initialIndex}
        maxVisible={10}
        onSubmit={(value) => handleSubmit(value, state, setState, onPick)}
        onCancel={onCancel}
      />
    </Surface>
  )
}

function handleSubmit(
  value: string,
  state: Extract<State, { kind: 'list' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): void {
  if (value.startsWith('hdr:')) return
  if (value.startsWith('ol:')) {
    onPick({ kind: 'ollama', model: value.slice(3) })
    return
  }
  if (value.startsWith('key:')) {
    const parsed = parseKeyValue(value)
    if (!parsed) return
    if (parsed.action === 'manage') {
      setState({ kind: 'keyManage', provider: parsed.provider, data: state.data, submitting: false })
      return
    }
    setState({ kind: 'keyEntry', provider: parsed.provider, action: parsed.action, data: state.data, submitting: false })
    return
  }
  if (value.startsWith('catalog:')) {
    const provider = value.slice('catalog:'.length)
    if (isCloudProvider(provider)) setState({ kind: 'catalog', provider, data: state.data })
    return
  }
  if (value.startsWith('c:')) {
    const parsed = parseCloudValue(value)
    if (parsed) {
      onPick({ kind: 'cloud', provider: parsed.provider, model: parsed.model, keyJustSet: false })
      return
    }
  }
}

function buildCatalogOptions(
  provider: CloudProviderId,
  catalog: ModelCatalogResult | undefined,
  currentProvider: ProviderId,
  currentModel: string,
): SelectOption<string>[] {
  if (!catalog || catalog.entries.length === 0) {
    return [{
      value: `hdr:catalog-empty:${provider}`,
      label: 'no models found',
      disabled: true,
      role: 'notice',
      prefix: 'note',
    }]
  }
  return catalog.entries.map(entry => {
    const active = currentProvider === provider && currentModel === entry.id
    const suffix = entry.source === 'fallback' ? '  fallback' : ''
    return {
      value: `full:${provider}:${entry.id}`,
      label: `${entry.id}${active ? '  *' : ''}${suffix}`,
      role: 'option',
    }
  })
}

function parseCloudValue(value: string): { provider: ProviderId; model: string } | null {
  if (!value.startsWith('c:')) return null
  const rest = value.slice(2)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  const provider = rest.slice(0, sep) as ProviderId
  const model = rest.slice(sep + 1)
  if (!provider || !model) return null
  return { provider, model }
}

function parseFullCatalogValue(value: string): { provider: CloudProviderId; model: string } | null {
  if (!value.startsWith('full:')) return null
  const rest = value.slice(5)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  const provider = rest.slice(0, sep)
  const model = rest.slice(sep + 1)
  if (!isCloudProvider(provider) || !model) return null
  return { provider, model }
}

function parseKeyValue(value: string): { action: 'set' | 'edit' | 'manage'; provider: CloudProviderId } | null {
  if (!value.startsWith('key:')) return null
  const parts = value.split(':')
  if (parts.length !== 3) return null
  const action = parts[1]
  const provider = parts[2]
  if (action !== 'set' && action !== 'edit' && action !== 'manage') return null
  if (!isCloudProvider(provider)) return null
  return { action, provider }
}

async function submitKey(
  state: Extract<State, { kind: 'keyEntry' }>,
  value: string,
  currentConfig: EthagentConfig,
  setState: (s: State) => void,
): Promise<void> {
  const trimmed = value.trim()
  if (!trimmed) {
    setState({ ...state, error: 'key cannot be empty' })
    return
  }
  setState({ ...state, submitting: true, error: undefined })
  try {
    await setKey(state.provider, trimmed)
    const data = await refreshProviderKeyState(state.data, currentConfig, state.provider)
    setState({ kind: 'list', data })
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
  }
}

async function deleteKey(
  state: Extract<State, { kind: 'keyManage' }>,
  currentConfig: EthagentConfig,
  setState: (s: State) => void,
): Promise<void> {
  setState({ ...state, submitting: true, error: undefined })
  try {
    await rmKey(state.provider)
    const data = await refreshProviderKeyState(state.data, currentConfig, state.provider)
    setState({ kind: 'list', data })
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
  }
}

async function refreshProviderKeyState(
  data: LoadedData,
  currentConfig: EthagentConfig,
  provider: CloudProviderId,
): Promise<LoadedData> {
  clearModelCatalogCache()
  const keySet = await hasKey(provider)
  const cloudKeys = { ...data.cloudKeys, [provider]: keySet }
  const cloudCatalogs = { ...data.cloudCatalogs }
  if (keySet) {
    cloudCatalogs[provider] = await discoverProviderModels(configForProvider(currentConfig, provider))
  } else {
    delete cloudCatalogs[provider]
  }
  return { ...data, cloudKeys, cloudCatalogs }
}

function configForProvider(config: EthagentConfig, provider: CloudProviderId): EthagentConfig {
  return {
    ...config,
    provider,
    model: config.provider === provider ? config.model : defaultModelFor(provider),
    baseUrl: provider === 'openai' && config.provider === 'openai' ? config.baseUrl : undefined,
  }
}

function providerKeyPlaceholder(provider: ProviderId): string {
  if (provider === 'openai') return 'sk-...'
  if (provider === 'anthropic') return 'sk-ant-...'
  if (provider === 'gemini') return 'AIza...'
  return ''
}

function isCloudProvider(value: string | undefined): value is CloudProviderId {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}

async function probeOllama(): Promise<{ up: boolean; error?: string; models: Array<{ name: string; sizeBytes: number }> }> {
  try {
    const up = await isDaemonUp()
    if (!up) return { up: false, error: 'ollama daemon is not running', models: [] }
    const installed = await listInstalled()
    return { up: true, models: installed.map(m => ({ name: m.name, sizeBytes: m.sizeBytes })) }
  } catch (err: unknown) {
    return { up: false, error: (err as Error).message, models: [] }
  }
}
