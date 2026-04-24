import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { theme } from './theme.js'
import { Select, type SelectOption } from './Select.js'
import { Spinner } from './Spinner.js'
import { TextInput } from './TextInput.js'
import { Surface } from './Surface.js'
import { listInstalled, isDaemonUp } from '../bootstrap/ollama.js'
import { hasKey, setKey } from '../storage/secrets.js'
import { defaultModelFor, type EthagentConfig, type ProviderId } from '../storage/config.js'
import { discoverProviderModels, type ModelCatalogEntry, type ModelCatalogResult } from '../models/catalog.js'

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

type OllamaEntry = { name: string; sizeBytes: number }
type LoadedData = {
  daemonUp: boolean
  daemonError?: string
  models: OllamaEntry[]
  cloudKeys: Record<ProviderId, boolean>
  cloudCatalogs: Partial<Record<ProviderId, ModelCatalogResult>>
}

type State =
  | { kind: 'loading' }
  | { kind: 'list'; data: LoadedData }
  | { kind: 'keyEntry'; provider: ProviderId; data: LoadedData; submitting: boolean; error?: string }

const CLOUD_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'gemini']

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
        Promise.all(CLOUD_PROVIDERS.map(async p => [p, await hasKey(p)] as const)),
      ])
      if (cancelled) return
      const cloudKeys = Object.fromEntries(keyEntries) as Record<ProviderId, boolean>
      const catalogEntries = await Promise.all(
        CLOUD_PROVIDERS
          .filter(provider => cloudKeys[provider])
          .map(async provider => [provider, await discoverProviderModels(configForProvider(currentConfig, provider))] as const),
      )
      if (cancelled) return
      const cloudCatalogs = Object.fromEntries(catalogEntries) as Partial<Record<ProviderId, ModelCatalogResult>>
      const data: LoadedData = {
        daemonUp: daemon.up,
        daemonError: daemon.error,
        models: daemon.models,
        cloudKeys,
        cloudCatalogs,
      }
      setState({ kind: 'list', data })
    })()
    return () => { cancelled = true }
  }, [currentConfig])

  if (state.kind === 'loading') {
    return (
      <Surface
        title="Switch Provider / Model"
        subtitle="Choose a provider and model."
      >
        <Spinner label="loading providers..." />
      </Surface>
    )
  }

  if (state.kind === 'keyEntry') {
    const { provider, submitting, error } = state
    return (
      <Surface
        title={`Set Up ${provider}`}
        subtitle="Stored in your OS keyring when available. Never written to config in plaintext."
        footer="Enter saves. Esc returns to the picker."
      >
        {submitting ? (
          <Spinner label={`saving ${provider} key...`} />
        ) : (
          <TextInput
            label={`${provider} key`}
            placeholder={providerKeyPlaceholder(provider)}
            isSecret
            onSubmit={(value) => void submitKey(state, value, setState, onPick)}
            onCancel={() => setState({ kind: 'list', data: state.data })}
          />
        )}
        {error ? <Text color="#e87070">{error}</Text> : null}
      </Surface>
    )
  }

  const { data } = state
  const options = buildOptions(data, currentProvider, currentModel)
  const initialIndex = options.findIndex(opt => {
    if (opt.disabled) return false
    if (opt.value.startsWith('ol:')) return opt.value.slice(3) === currentModel && currentProvider === 'ollama'
    const cloud = parseCloudValue(opt.value)
    return cloud?.provider === currentProvider && cloud.model === currentModel
  })

  return (
    <Surface
      title="Switch Provider / Model"
      subtitle="Select a local Ollama model or a configured cloud provider."
      footer="Enter selects. Esc closes."
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

function buildOptions(
  data: LoadedData,
  currentProvider: ProviderId,
  currentModel: string,
): SelectOption<string>[] {
  const options: SelectOption<string>[] = []

  options.push({ value: 'hdr:local', label: 'Local / Ollama', disabled: true })
  if (!data.daemonUp) {
    options.push({
      value: 'hdr:local-off',
      label: `  ${data.daemonError ?? 'daemon not running'}`,
      disabled: true,
    })
  } else if (data.models.length === 0) {
    options.push({
      value: 'hdr:no-models',
      label: '  no models installed - pull one with /pull <name>',
      disabled: true,
    })
  } else {
    for (const m of data.models) {
      const active = currentProvider === 'ollama' && m.name === currentModel
      options.push({
        value: `ol:${m.name}`,
        label: active ? `${m.name}  *` : m.name,
        hint: formatSize(m.sizeBytes),
      })
    }
  }

  options.push({ value: 'hdr:cloud', label: 'Cloud', disabled: true })
  for (const p of CLOUD_PROVIDERS) {
    const keySet = data.cloudKeys[p]
    options.push({ value: `hdr:cloud:${p}`, label: `  ${p}`, disabled: true })
    if (!keySet) {
      options.push({
        value: `key:${p}`,
        label: '    set key first',
        hint: 'enter to configure',
      })
      continue
    }
    const catalog = data.cloudCatalogs[p]
    const entries = catalog?.entries ?? []
    if (entries.length === 0) {
      options.push({
        value: `hdr:cloud-empty:${p}`,
        label: '    no models found',
        disabled: true,
      })
      continue
    }
    for (const model of entries) {
      const active = currentProvider === p && currentModel === model.id
      options.push({
        value: `c:${p}:${model.id}`,
        label: `    ${active ? `${model.id}  *` : model.id}`,
        hint: cloudModelHint(model, catalog),
      })
    }
  }

  return options
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
    const provider = value.slice(4) as ProviderId
    setState({ kind: 'keyEntry', provider, data: state.data, submitting: false })
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

async function submitKey(
  state: Extract<State, { kind: 'keyEntry' }>,
  value: string,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  const trimmed = value.trim()
  if (!trimmed) {
    setState({ ...state, error: 'key cannot be empty' })
    return
  }
  setState({ ...state, submitting: true, error: undefined })
  try {
    await setKey(state.provider, trimmed)
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
    return
  }
  onPick({
    kind: 'cloud',
    provider: state.provider,
    model: defaultModelFor(state.provider),
    keyJustSet: true,
  })
}

function configForProvider(config: EthagentConfig, provider: ProviderId): EthagentConfig {
  return {
    ...config,
    provider,
    model: config.provider === provider ? config.model : defaultModelFor(provider),
    baseUrl: provider === 'openai' && config.provider === 'openai' ? config.baseUrl : undefined,
  }
}

function cloudModelHint(model: ModelCatalogEntry, catalog?: ModelCatalogResult): string {
  if (model.source === 'fallback') {
    const reason = catalog?.error ? ` (${catalog.error})` : ''
    return `fallback${reason}`
  }
  return model.description ?? 'discovered'
}

function providerKeyPlaceholder(provider: ProviderId): string {
  if (provider === 'openai') return 'sk-...'
  if (provider === 'anthropic') return 'sk-ant-...'
  if (provider === 'gemini') return 'AIza...'
  return ''
}

async function probeOllama(): Promise<{ up: boolean; error?: string; models: OllamaEntry[] }> {
  try {
    const up = await isDaemonUp()
    if (!up) return { up: false, error: 'ollama daemon is not running', models: [] }
    const installed = await listInstalled()
    return { up: true, models: installed.map(m => ({ name: m.name, sizeBytes: m.sizeBytes })) }
  } catch (err: unknown) {
    return { up: false, error: (err as Error).message, models: [] }
  }
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return ''
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}
