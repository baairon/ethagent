import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { Select, type SelectOption } from './Select.js'
import { Spinner } from './Spinner.js'
import { TextInput } from './TextInput.js'
import { Surface } from './Surface.js'
import { ProgressBar } from './ProgressBar.js'
import { theme } from './theme.js'
import { deleteModel as deleteOllamaModel, listInstalled, isDaemonUp } from '../bootstrap/ollama.js'
import {
  buildLlamaCppRunner,
  DEFAULT_LLAMA_HOST,
  detectLlamaCpp,
  installLlamaCppRunner,
  setLlamaCppServerPath,
  startLlamaCppServer,
  type LlamaCppInstallProgress,
  type LlamaCppInstallResult,
  type LlamaCppStartResult,
} from '../bootstrap/llamacpp.js'
import { detectSpec, type SpecSnapshot } from '../bootstrap/runtimeDetection.js'
import {
  estimateGgufMachineFit,
  orderGgufFilesForSpec,
  qwenLadder,
  recommendGgufFile,
  type GgufMachineFit,
} from '../bootstrap/modelRecommendation.js'
import { hasKey, rmKey, setKey } from '../storage/secrets.js'
import { defaultModelFor, type EthagentConfig, type ProviderId } from '../storage/config.js'
import { clearModelCatalogCache, discoverProviderModels, type ModelCatalogResult } from '../models/catalog.js'
import { contextWindowInfo } from '../runtime/compaction.js'
import {
  createHfDownloadPlan,
  downloadHfModel,
  fetchHuggingFaceRepoInfo,
  findLocalHfModel,
  ggufFiles,
  loadLocalHfModels,
  modelFromPlan,
  parseHuggingFaceRef,
  uninstallLocalHfModel,
  type HfCredibility,
  type HfDownloadPlan,
  type HfDownloadProgress,
  type HfRisk,
  type HuggingFaceRepoInfo,
  type HuggingFaceSibling,
  type LocalHfModel,
} from '../models/huggingface.js'
import {
  buildModelPickerOptions,
  LOCAL_MODEL_LINK_EXAMPLE,
  LOCAL_MODEL_LINK_HINT,
  MODEL_PICKER_CLOUD_PROVIDERS,
  orderModelsForContextFit,
  type CloudProviderId,
  type ModelPickerContextFit,
  type ModelPickerOptionsData,
} from './modelPickerOptions.js'
import { formatLocalHfModelDisplayName, formatModelDisplayName } from './modelDisplay.js'

export type ModelPickerSelection =
  | { kind: 'ollama'; model: string }
  | { kind: 'llamacpp'; model: string }
  | { kind: 'cloud'; provider: CloudProviderId; model: string; keyJustSet: boolean }

type ModelPickerProps = {
  currentConfig: EthagentConfig
  currentProvider: ProviderId
  currentModel: string
  contextFit?: ModelPickerContextFit | null
  onPick: (selection: ModelPickerSelection) => void
  onCancel: () => void
}

type LoadedData = ModelPickerOptionsData
type LocalUninstallTarget =
  | { kind: 'ollama'; id: string; displayName: string; sizeBytes: number }
  | { kind: 'hf'; id: string; displayName: string; sizeBytes: number }

type State =
  | { kind: 'loading' }
  | { kind: 'list'; data: LoadedData }
  | { kind: 'catalog'; provider: CloudProviderId; data: LoadedData }
  | { kind: 'keyEntry'; provider: CloudProviderId; action: 'set' | 'edit'; data: LoadedData; submitting: boolean; error?: string }
  | { kind: 'keyManage'; provider: CloudProviderId; data: LoadedData; submitting: boolean; error?: string }
  | { kind: 'hfInput'; data: LoadedData; error?: string }
  | { kind: 'hfLoading'; data: LoadedData; input: string }
  | { kind: 'hfFilePick'; data: LoadedData; input: string; repo: HuggingFaceRepoInfo; files: HuggingFaceSibling[] }
  | { kind: 'hfReview'; data: LoadedData; plan: HfDownloadPlan }
  | { kind: 'hfDownloading'; data: LoadedData; plan: HfDownloadPlan; progress: HfDownloadProgress }
  | { kind: 'hfDone'; data: LoadedData; model: LocalHfModel }
  | { kind: 'hfError'; data: LoadedData; message: string; input?: string }
  | { kind: 'localUninstallPick'; data: LoadedData }
  | { kind: 'localUninstallConfirm'; data: LoadedData; target: LocalUninstallTarget }
  | { kind: 'localUninstalling'; data: LoadedData; target: LocalUninstallTarget }
  | { kind: 'localUninstallDone'; data: LoadedData; modelName: string }
  | { kind: 'localUninstallError'; data: LoadedData; target: LocalUninstallTarget; message: string }
  | { kind: 'localRunnerSetup'; data: LoadedData; model: LocalHfModel }
  | { kind: 'localRunnerInstalling'; data: LoadedData; model: LocalHfModel; startedAt: number; progress: LlamaCppInstallProgress }
  | { kind: 'localRunnerInstallFail'; data: LoadedData; model: LocalHfModel; result: Extract<LlamaCppInstallResult, { ok: false }> }
  | { kind: 'localRunnerPathEntry'; data: LoadedData; model: LocalHfModel; submitting: boolean; error?: string }
  | { kind: 'localRunnerStarting'; data: LoadedData; model: LocalHfModel; startedAt: number }
  | { kind: 'localRunnerStartFail'; data: LoadedData; model: LocalHfModel; result: Extract<LlamaCppStartResult, { ok: false }> }
  | { kind: 'qwenCatalog'; data: LoadedData }
  | { kind: 'qwenConfirmPull'; data: LoadedData; model: string; approxGB: number }

export const ModelPicker: React.FC<ModelPickerProps> = ({
  currentConfig,
  currentProvider,
  currentModel,
  contextFit,
  onPick,
  onCancel,
}) => {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const hfAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [daemon, llamaCpp, hfModels, machineSpec, keyEntries] = await Promise.all([
        probeOllama(),
        probeLlamaCpp(),
        loadHfPickerModels(),
        detectSpec(),
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
          llamaCpp,
          hfModels,
          machineSpec,
          cloudKeys,
          cloudCatalogs,
        },
      })
    })()
    return () => { cancelled = true }
  }, [currentConfig])

  useEffect(() => () => {
    hfAbortRef.current?.abort()
  }, [])

  if (state.kind === 'loading') {
    return (
      <Surface title={contextFit ? 'Switch to Larger-Context Model' : 'Switch Provider / Model'} subtitle="Loading providers and models.">
        <Spinner label="loading providers..." />
      </Surface>
    )
  }

  if (state.kind === 'hfInput') {
    return (
      <Surface
        title="Add Local Model"
        subtitle={LOCAL_MODEL_LINK_EXAMPLE}
        footer="enter checks link · esc returns to picker"
      >
        <TextInput
          label="model link"
          placeholder={LOCAL_MODEL_LINK_HINT}
          onSubmit={value => void inspectHfInput(state, value, setState)}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
        {state.error ? <Text color="#e87070">{state.error}</Text> : null}
      </Surface>
    )
  }

  if (state.kind === 'hfLoading') {
    return (
      <Surface title="Checking Model Link" subtitle={state.input}>
        <Spinner label="reading model page..." />
      </Surface>
    )
  }

  if (state.kind === 'hfFilePick') {
    const options = buildHfFileOptions(state.repo, state.files, state.data.machineSpec)
    const recommendedIndex = Math.max(0, options.findIndex(option => option.hint?.includes('recommended')))
    return (
      <Surface
        title="Choose a Compatible File"
        subtitle={`${state.repo.repoId} has ${state.files.length} compatible local model file${state.files.length === 1 ? '' : 's'}.`}
        footer="enter selects · esc returns to link input"
      >
        <Select
          options={options}
          initialIndex={recommendedIndex}
          maxVisible={10}
          onSubmit={filename => void reviewHfFile(state, filename, setState)}
          onCancel={() => setState({ kind: 'hfInput', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'hfReview') {
    const { plan } = state
    const canDownload = plan.review.risk !== 'high' && plan.review.runtime === 'llama.cpp runnable'
    const fit = state.data.machineSpec ? estimateGgufMachineFit(plan.sizeBytes, state.data.machineSpec) : null
    const recommended = state.data.machineSpec ? recommendGgufFile(plan.repo, ggufFiles(plan.repo), state.data.machineSpec) : null
    return (
      <Surface
        title="Review Model Link"
        subtitle="Only download models from creators you trust. Check the license and source before continuing."
        footer="enter selects · esc returns to picker"
        tone={plan.review.risk === 'high' ? 'error' : plan.review.risk === 'medium' ? 'muted' : 'primary'}
      >
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.text}>{plan.displayName}</Text>
          <Text color={theme.dim}>source: huggingface.co/{plan.repoId}</Text>
          <Text color={theme.dim}>file: {friendlyFileName(plan.filename)}</Text>
          <Text color={theme.dim}>license: {plan.repo.license ?? 'unknown'} - size: {formatBytes(plan.sizeBytes)}</Text>
          {fit ? <Text color={fitColor(fit.fit)}>fit: {fitLabel(fit.fit, recommended?.file.filename === plan.filename)}</Text> : null}
          <Text color={riskColor(plan.review.risk)}>safety: {safetyLabel(plan.review.risk)} - source: {credibilityLabel(plan.review.credibility)}</Text>
          <Text color={theme.dim}>signals: {formatSignals(plan.repo.downloads, plan.repo.likes)}</Text>
          <Text color={theme.dim}>notes: {friendlyReasons(plan.review.reasons).join('; ')}</Text>
        </Box>
        <Select<'download' | 'pick' | 'cancel'>
          options={[
            { value: 'download', label: 'download this model', disabled: !canDownload },
            { value: 'pick', label: 'pick another file' },
            { value: 'cancel', label: 'cancel' },
          ]}
          onSubmit={choice => {
            if (choice === 'download') void startHfDownload(state, setState, hfAbortRef, onPick)
            else if (choice === 'pick') void inspectHfInput({ kind: 'hfInput', data: state.data }, plan.repoId, setState)
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'hfDownloading') {
    const total = state.progress.total ?? state.plan.sizeBytes
    const completed = state.progress.completed ?? 0
    const progress = total > 0 ? completed / total : 0
    const suffix = total > 0 ? `${formatBytes(completed)} / ${formatBytes(total)}` : formatBytes(completed)
    return (
      <Surface title="Downloading Model" subtitle={state.plan.displayName}>
        <Text color={theme.dim}>{state.progress.status}</Text>
        <ProgressBar progress={progress} suffix={suffix} variant="rainbow" />
      </Surface>
    )
  }

  if (state.kind === 'hfDone') {
    return (
      <Surface
        title="Model Ready"
        subtitle={state.model.displayName}
        footer="enter selects · esc returns to picker"
      >
        <Select<'use' | 'back'>
          options={[
            { value: 'use', label: 'use this model now' },
            { value: 'back', label: 'back to picker' },
          ]}
          onSubmit={choice => {
            if (choice === 'use') void startAndPickHfModel(state.model, state, setState, onPick)
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'hfError') {
    return (
      <Surface title="Model Link Failed" subtitle={state.message} tone="error" footer="enter selects · esc returns to picker">
        <Select<'retry' | 'back'>
          options={[
            { value: 'retry', label: state.input ? 'retry link' : 'download another model' },
            { value: 'back', label: 'back to picker' },
          ]}
          onSubmit={choice => {
            if (choice === 'retry') setState({ kind: 'hfInput', data: state.data, error: state.input ? undefined : state.message })
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'localUninstallPick') {
    const targets = localUninstallTargets(state.data)
    const options = targets.map(target => ({
      value: `${target.kind}:${target.id}`,
      label: target.displayName,
      hint: [
        target.kind === 'ollama' ? 'ollama' : 'downloaded GGUF file',
        formatBytes(target.sizeBytes),
        isCurrentLocalUninstallTarget(target, currentProvider, currentModel) ? 'currently selected' : '',
      ].filter(Boolean).join(' - '),
      role: 'option' as const,
    }))
    return (
      <Surface title="Uninstall Local Model" subtitle="Choose an Ollama model or downloaded GGUF file to remove." footer="enter selects · esc returns to picker">
        {options.length === 0 ? (
          <Text color={theme.dim}>No local models found.</Text>
        ) : (
          <Select
            options={options}
            maxVisible={10}
            onSubmit={value => {
              const target = targets.find(item => `${item.kind}:${item.id}` === value)
              if (target) setState({ kind: 'localUninstallConfirm', data: state.data, target })
            }}
            onCancel={() => setState({ kind: 'list', data: state.data })}
          />
        )}
      </Surface>
    )
  }

  if (state.kind === 'localUninstallConfirm') {
    const modelName = state.target.displayName
    return (
      <Surface title="Confirm Uninstall" subtitle={modelName} footer="enter selects · esc returns to model list">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>{localUninstallBoundaryCopy(state.target)}</Text>
          <Text color={theme.dim}>Runner binaries are left unchanged.</Text>
        </Box>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', label: 'uninstall local model' },
            { value: 'back', label: 'back' },
          ]}
          onSubmit={choice => {
            if (choice === 'confirm') void uninstallLocalModel(state, setState)
            else setState({ kind: 'localUninstallPick', data: state.data })
          }}
          onCancel={() => setState({ kind: 'localUninstallPick', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'localUninstalling') {
    return (
      <Surface
        title="Uninstalling Local Model"
        subtitle={state.target.displayName}
      >
        <Spinner label="removing local model..." />
      </Surface>
    )
  }

  if (state.kind === 'localUninstallDone') {
    return (
      <Surface title="Local Model Uninstalled" subtitle={state.modelName} footer="enter returns to picker · esc closes">
        <Select<'back'>
          options={[{ value: 'back', label: 'back to picker' }]}
          onSubmit={() => setState({ kind: 'list', data: state.data })}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'localUninstallError') {
    return (
      <Surface title="Could Not Uninstall Local Model" subtitle={state.message} tone="error" footer="enter selects · esc returns to picker">
        <Select<'retry' | 'back'>
          options={[
            { value: 'retry', label: 'try again' },
            { value: 'back', label: 'back to picker' },
          ]}
          onSubmit={choice => {
            if (choice === 'retry') void uninstallLocalModel({ kind: 'localUninstallConfirm', data: state.data, target: state.target }, setState)
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'localRunnerSetup') {
    return (
      <Surface
        title="Install Local Runner"
        subtitle="This model is downloaded. Install the local runner once to start it here."
        footer="enter selects · esc returns to picker"
      >
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>Ethagent tried to start {friendlyFileName(state.model.filename)} automatically.</Text>
          <Text color={theme.dim}>After this one-time install, downloaded local models start automatically.</Text>
          <Text color={theme.dim}>Advanced: paste an existing llama-server path or run a compatible server at {DEFAULT_LLAMA_HOST}.</Text>
        </Box>
        <Select<'install' | 'path' | 'back' | 'download'>
          options={[
            { value: 'install', label: 'install local runner' },
            { value: 'path', label: 'use existing runner path' },
            { value: 'back', label: 'back to picker' },
            { value: 'download', label: 'add another local model' },
          ]}
          onSubmit={choice => {
            if (choice === 'download') setState({ kind: 'hfInput', data: state.data })
            else if (choice === 'install') void installRunnerAndStart(state, setState, onPick)
            else if (choice === 'path') setState({ kind: 'localRunnerPathEntry', data: state.data, model: state.model, submitting: false })
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'localRunnerInstalling') {
    return (
      <Surface title="Installing Local Runner" subtitle="This may take a few minutes.">
        <ElapsedSpinner startedAt={state.startedAt} label={state.progress.label} />
        <ProgressBar progress={state.progress.progress} variant="rainbow" />
      </Surface>
    )
  }

  if (state.kind === 'localRunnerInstallFail') {
    const options = buildRunnerRecoveryOptions(state.result)
    return (
      <Surface title="Runner Setup Needs Attention" subtitle={state.result.message} tone="error" footer="enter selects · esc returns to picker">
        <Select<'retry' | 'build' | 'path' | 'back'>
          options={options}
          onSubmit={choice => {
            if (choice === 'retry') void installRunnerAndStart({ kind: 'localRunnerSetup', data: state.data, model: state.model }, setState, onPick)
            else if (choice === 'build') void buildRunnerAndStart({ kind: 'localRunnerSetup', data: state.data, model: state.model }, setState, onPick)
            else if (choice === 'path') setState({ kind: 'localRunnerPathEntry', data: state.data, model: state.model, submitting: false })
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'localRunnerPathEntry') {
    return (
      <Surface
        title="Runner Path"
        subtitle="Paste the full path to llama-server."
        footer="enter saves · esc returns to install"
      >
        {state.submitting ? (
          <Spinner label="checking runner path..." />
        ) : (
          <TextInput
            label="llama-server"
            placeholder={runnerPathPlaceholder()}
            onSubmit={value => void saveRunnerPathAndStart(state, value, setState, onPick)}
            onCancel={() => setState({ kind: 'localRunnerSetup', data: state.data, model: state.model })}
          />
        )}
        {state.error ? <Text color="#e87070">{state.error}</Text> : null}
      </Surface>
    )
  }

  if (state.kind === 'localRunnerStarting') {
    return (
      <Surface title="Starting Local Model" subtitle={state.model.displayName}>
        <ElapsedSpinner startedAt={state.startedAt} label="starting local runner" />
      </Surface>
    )
  }

  if (state.kind === 'localRunnerStartFail') {
    return (
      <Surface title="Local Model Failed to Start" subtitle={localRunnerStartFailureSubtitle(state.result)} tone="error" footer="enter selects · esc returns to picker">
        <Select<'retry' | 'path' | 'install' | 'back'>
          options={[
            { value: 'retry', label: 'try again' },
            { value: 'path', label: 'use existing runner path' },
            { value: 'install', label: 'install local runner' },
            { value: 'back', label: 'back to picker' },
          ]}
          onSubmit={choice => {
            if (choice === 'retry') void startAndPickHfModel(state.model, { kind: 'hfDone', data: state.data, model: state.model }, setState, onPick)
            else if (choice === 'path') setState({ kind: 'localRunnerPathEntry', data: state.data, model: state.model, submitting: false })
            else if (choice === 'install') void installRunnerAndStart({ kind: 'localRunnerSetup', data: state.data, model: state.model }, setState, onPick)
            else setState({ kind: 'list', data: state.data })
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'keyEntry') {
    const { provider, action, submitting, error } = state
    return (
      <Surface
        title={`${capitalize(action)} ${provider} API Key`}
        subtitle="Stored in your OS keyring when available; never written to config in plaintext."
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
        title={`${capitalize(provider)} API Key`}
        subtitle="Manage the stored key for this provider."
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

  if (state.kind === 'qwenCatalog') {
    const installed = new Set(state.data.models.map(m => m.name))
    const isActive = (model: string) => currentProvider === 'ollama' && currentModel === model
    const options: SelectOption<string>[] = qwenLadder.map(variant => {
      const isInstalled = installed.has(variant.model)
      const active = isActive(variant.model)
      const markers = [
        active ? '*' : '',
        isInstalled ? '✓ installed' : '',
      ].filter(Boolean).join('  ')
      return {
        value: `qw:${variant.model}`,
        label: `${variant.label}  ${variant.model}${markers ? `  ${markers}` : ''}`,
        hint: `~${variant.approxDownloadGB} GB download`,
        role: 'option' as const,
      }
    })
    return (
      <Surface
        title="Qwen Catalog"
        subtitle="Qwen 2.5 Coder variants for Ollama."
        footer="enter selects · esc returns to picker"
      >
        <Select
          options={options}
          maxVisible={10}
          onSubmit={value => {
            if (!value.startsWith('qw:')) return
            const model = value.slice(3)
            if (installed.has(model)) {
              onPick({ kind: 'ollama', model })
            } else {
              const variant = qwenLadder.find(v => v.model === model)
              setState({ kind: 'qwenConfirmPull', data: state.data, model, approxGB: variant?.approxDownloadGB ?? 0 })
            }
          }}
          onCancel={() => setState({ kind: 'list', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'qwenConfirmPull') {
    return (
      <Surface
        title="Model Not Installed"
        subtitle={`${state.model} is not downloaded yet (~${state.approxGB} GB).`}
        footer="enter selects · esc returns to catalog"
      >
        <Select<'pull' | 'back'>
          options={[
            { value: 'pull', label: 'pull and switch to this model' },
            { value: 'back', label: 'back to catalog' },
          ]}
          onSubmit={choice => {
            if (choice === 'pull') onPick({ kind: 'ollama', model: state.model })
            else setState({ kind: 'qwenCatalog', data: state.data })
          }}
          onCancel={() => setState({ kind: 'qwenCatalog', data: state.data })}
        />
      </Surface>
    )
  }

  if (state.kind === 'catalog') {
    const catalog = state.data.cloudCatalogs[state.provider]
    const options = buildCatalogOptions(state.provider, catalog, currentProvider, currentModel, contextFit)
    const initialIndex = options.findIndex(opt => {
      if (opt.disabled) return false
      const parsed = parseFullCatalogValue(opt.value)
      return parsed?.provider === currentProvider && parsed.model === currentModel
    })
    return (
      <Surface
        title={`${capitalize(state.provider)} Full Catalog`}
        subtitle={contextFit ? contextFitSubtitle(contextFit) : 'All discovered models for this provider'}
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
  const options = buildModelPickerOptions(data, { currentProvider, currentModel, contextFit })
  const initialIndex = options.findIndex(opt => {
    if (opt.disabled) return false
    if (opt.value.startsWith('ol:')) return opt.value.slice(3) === currentModel && currentProvider === 'ollama'
    if (opt.value.startsWith('hf:')) return opt.value.slice(3) === currentModel && currentProvider === 'llamacpp'
    const cloud = parseCloudValue(opt.value)
    return cloud?.provider === currentProvider && cloud.model === currentModel
  })

  return (
    <Surface
      title={contextFit ? 'Switch to Larger-Context Model' : 'Switch Provider / Model'}
      subtitle={contextFit ? contextFitSubtitle(contextFit) : 'Ollama + added files'}
      footer="enter selects · esc closes · /models lists installed models"
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
  if (value.startsWith('hf:')) {
    const id = value.slice(3)
    if (id === 'download') {
      setState({ kind: 'hfInput', data: state.data })
      return
    }
    const model = state.data.hfModels.find(item => item.id === id)
    if (!model) return
    void (async () => {
      const local = await findLocalHfModel(id)
      if (!local) {
        setState({ kind: 'hfError', data: state.data, message: 'local model metadata was not found' })
        return
      }
      await startAndPickHfModel(local, state, setState, onPick)
    })()
    return
  }
  if (value === 'local:uninstall') {
    setState({ kind: 'localUninstallPick', data: state.data })
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
  if (value === 'qwen-catalog') {
    setState({ kind: 'qwenCatalog', data: state.data })
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
  contextFit?: ModelPickerContextFit | null,
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

function parseCloudValue(value: string): { provider: CloudProviderId; model: string } | null {
  if (!value.startsWith('c:')) return null
  const rest = value.slice(2)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  const provider = rest.slice(0, sep)
  const model = rest.slice(sep + 1)
  if (!isCloudProvider(provider) || !model) return null
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

function buildHfFileOptions(
  repo: HuggingFaceRepoInfo,
  files: HuggingFaceSibling[],
  spec: SpecSnapshot | undefined,
): SelectOption<string>[] {
  const ordered = spec
    ? orderGgufFilesForSpec(repo, files, spec)
    : files.map(file => ({ file, fit: 'unknown' as GgufMachineFit, score: 0, budgetBytes: 0 }))
  const recommended = spec ? ordered[0]?.file.filename : undefined
  return ordered.map(item => {
    const size = item.file.sizeBytes ? ` - ${formatBytes(item.file.sizeBytes)}` : ''
    const recommendedHint = item.file.filename === recommended
      ? item.fit === 'too-large' ? 'best match found; may be too large' : 'recommended for this machine'
      : undefined
    const fitHint = spec && item.file.filename !== recommended ? fileFitHint(item.fit) : undefined
    return {
      value: item.file.filename,
      label: `${item.file.filename}${size}`,
      hint: [recommendedHint, fitHint].filter(Boolean).join(' - ') || undefined,
      role: 'option' as const,
    }
  })
}

function buildRunnerRecoveryOptions(
  result: Extract<LlamaCppInstallResult, { ok: false }>,
): SelectOption<'retry' | 'build' | 'path' | 'back'>[] {
  const options: SelectOption<'retry' | 'build' | 'path' | 'back'>[] = []
  if (result.recovery.includes('source-build')) {
    options.push({
      value: 'build',
      label: 'build local runner',
      hint: 'uses git and cmake if installed',
    })
  }
  if (result.recovery.includes('runner-path')) {
    options.push({ value: 'path', label: 'use existing runner path' })
  }
  if (result.recovery.includes('retry-install')) {
    options.push({ value: 'retry', label: 'retry automatic install' })
  }
  options.push({ value: 'back', label: 'back to picker' })
  return options
}

function localRunnerStartFailureSubtitle(result: Extract<LlamaCppStartResult, { ok: false }>): string {
  switch (result.code) {
    case 'readiness-timeout':
      return 'the local runner is still loading or did not answer in time'
    case 'runner-exited':
      return 'the local runner closed before becoming ready'
    case 'spawn-failed':
      return 'the local runner could not be started'
    case 'different-model-running':
      return result.message
    case 'model-file-missing':
      return result.message
    case 'runner-not-installed':
      return 'this machine still needs a local runner'
  }
}

async function inspectHfInput(
  state: Extract<State, { kind: 'hfInput' }>,
  value: string,
  setState: (s: State) => void,
): Promise<void> {
  const input = value.trim()
  if (!input) {
    setState({ ...state, error: 'paste a model link or repo id' })
    return
  }
  setState({ kind: 'hfLoading', data: state.data, input })
  try {
    const ref = parseHuggingFaceRef(input)
    const repo = await fetchHuggingFaceRepoInfo(ref)
    const files = ggufFiles(repo)
    if (files.length === 0) {
      setState({
        kind: 'hfInput',
        data: state.data,
        error: 'no compatible local model files found; paste a different model link',
      })
      return
    }
    const recommendedFilename = state.data.machineSpec
      ? recommendGgufFile(repo, files, state.data.machineSpec)?.file.filename
      : files[0]?.filename
    if (ref.filename || files.length === 1) {
      const plan = await createHfDownloadPlan(input, ref.filename ?? recommendedFilename)
      setState({ kind: 'hfReview', data: state.data, plan })
      return
    }
    setState({ kind: 'hfFilePick', data: state.data, input, repo, files })
  } catch (err: unknown) {
    setState({ kind: 'hfInput', data: state.data, error: (err as Error).message })
  }
}

async function reviewHfFile(
  state: Extract<State, { kind: 'hfFilePick' }>,
  filename: string,
  setState: (s: State) => void,
): Promise<void> {
  setState({ kind: 'hfLoading', data: state.data, input: state.input })
  try {
    const plan = await createHfDownloadPlan(state.input, filename)
    setState({ kind: 'hfReview', data: state.data, plan })
  } catch (err: unknown) {
    setState({ kind: 'hfError', data: state.data, message: (err as Error).message, input: state.input })
  }
}

async function startHfDownload(
  state: Extract<State, { kind: 'hfReview' }>,
  setState: (s: State) => void,
  abortRef: React.MutableRefObject<AbortController | null>,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  const controller = new AbortController()
  abortRef.current = controller
  setState({ kind: 'hfDownloading', data: state.data, plan: state.plan, progress: { status: 'starting', completed: 0, total: state.plan.sizeBytes } })
  try {
    for await (const progress of downloadHfModel(state.plan, controller.signal)) {
      if (controller.signal.aborted) return
      setState({ kind: 'hfDownloading', data: state.data, plan: state.plan, progress })
    }
    const model = await findLocalHfModel(`${state.plan.repoId}#${state.plan.filename}`)
      ?? modelFromPlan(state.plan, undefined, 'ready')
    const data = {
      ...state.data,
      hfModels: await loadHfPickerModels(),
    }
    await startAndPickHfModel(model, { kind: 'hfDone', data, model }, setState, onPick)
  } catch (err: unknown) {
    if (controller.signal.aborted) return
    setState({ kind: 'hfError', data: state.data, message: (err as Error).message, input: state.plan.repoId })
  } finally {
    abortRef.current = null
  }
}

function localUninstallTargets(data: LoadedData): LocalUninstallTarget[] {
  return [
    ...data.models.map(model => ({
      kind: 'ollama' as const,
      id: model.name,
      displayName: formatModelDisplayName('ollama', model.name, { maxLength: 64 }),
      sizeBytes: model.sizeBytes,
    })),
    ...data.hfModels.map(model => ({
      kind: 'hf' as const,
      id: model.id,
      displayName: formatLocalHfModelDisplayName(model.id, {
        displayName: model.displayName,
        maxLength: 64,
      }),
      sizeBytes: model.sizeBytes,
    })),
  ]
}

function isCurrentLocalUninstallTarget(
  target: LocalUninstallTarget,
  currentProvider: ProviderId,
  currentModel: string,
): boolean {
  return (target.kind === 'ollama' && currentProvider === 'ollama' && target.id === currentModel)
    || (target.kind === 'hf' && currentProvider === 'llamacpp' && target.id === currentModel)
}

function localUninstallBoundaryCopy(target: LocalUninstallTarget): string {
  if (target.kind === 'ollama') {
    return 'This removes the Ollama model from this machine. Downloaded GGUF files are left unchanged.'
  }
  return 'This removes only the downloaded GGUF file and metadata from this machine. Ollama models are left unchanged.'
}

async function uninstallLocalModel(
  state: Extract<State, { kind: 'localUninstallConfirm' }>,
  setState: (s: State) => void,
): Promise<void> {
  setState({ kind: 'localUninstalling', data: state.data, target: state.target })
  const modelName = state.target.displayName
  try {
    if (state.target.kind === 'ollama') await deleteOllamaModel(state.target.id)
    else await uninstallLocalHfModel(state.target.id)
    const data = await refreshLocalModelData(state.data)
    setState({ kind: 'localUninstallDone', data, modelName })
  } catch (err: unknown) {
    setState({
      kind: 'localUninstallError',
      data: state.data,
      target: state.target,
      message: (err as Error).message,
    })
  }
}

async function refreshLocalModelData(data: LoadedData): Promise<LoadedData> {
  const [daemon, hfModels] = await Promise.all([
    probeOllama(),
    loadHfPickerModels(),
  ])
  return {
    ...data,
    daemonUp: daemon.up,
    daemonError: daemon.error,
    models: daemon.models,
    hfModels,
  }
}

async function startAndPickHfModel(
  model: LocalHfModel,
  state: Extract<State, { kind: 'list' | 'hfDone' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  if (model.risk === 'high') {
    setState({ kind: 'hfError', data: state.data, message: 'blocked high-risk model; choose a model from a more credible source' })
    return
  }
  setState({ kind: 'localRunnerStarting', data: state.data, model, startedAt: Date.now() })
  const result = await startLlamaCppServer({
    modelPath: model.localPath,
    modelAlias: model.id,
  })
  const llamaCpp = await probeLlamaCpp()
  const data = { ...state.data, llamaCpp }
  if (!result.ok) {
    if (result.code === 'runner-not-installed') {
      setState({ kind: 'localRunnerSetup', data, model })
      return
    }
    setState({ kind: 'localRunnerStartFail', data, model, result })
    return
  }
  onPick({ kind: 'llamacpp', model: model.id })
}

async function installRunnerAndStart(
  state: Extract<State, { kind: 'localRunnerSetup' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  await runRunnerSetup(state, setState, onPick, installLlamaCppRunner)
}

async function buildRunnerAndStart(
  state: Extract<State, { kind: 'localRunnerSetup' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  await runRunnerSetup(state, setState, onPick, buildLlamaCppRunner)
}

async function runRunnerSetup(
  state: Extract<State, { kind: 'localRunnerSetup' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
  setup: (onProgress?: (progress: LlamaCppInstallProgress) => void) => Promise<LlamaCppInstallResult>,
): Promise<void> {
  const startedAt = Date.now()
  const initialProgress: LlamaCppInstallProgress = {
    phase: 'checking',
    label: 'preparing local runner',
    progress: 0.04,
  }
  const updateProgress = (progress: LlamaCppInstallProgress): void => {
    setState({ kind: 'localRunnerInstalling', data: state.data, model: state.model, startedAt, progress })
  }

  setState({ kind: 'localRunnerInstalling', data: state.data, model: state.model, startedAt, progress: initialProgress })
  const result = await setup(updateProgress)
  if (!result.ok) {
    setState({ kind: 'localRunnerInstallFail', data: state.data, model: state.model, result })
    return
  }
  await startAndPickHfModel(state.model, { kind: 'hfDone', data: state.data, model: state.model }, setState, onPick)
}

async function saveRunnerPathAndStart(
  state: Extract<State, { kind: 'localRunnerPathEntry' }>,
  value: string,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  const runnerPath = value.trim().replace(/^"|"$/g, '')
  if (!runnerPath) {
    setState({ ...state, error: 'paste the full path to llama-server' })
    return
  }
  setState({ ...state, submitting: true, error: undefined })
  try {
    await setLlamaCppServerPath(runnerPath)
    await startAndPickHfModel(state.model, { kind: 'hfDone', data: state.data, model: state.model }, setState, onPick)
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
  }
}

function contextFitSubtitle(contextFit: ModelPickerContextFit): string {
  const threshold = contextFit.thresholdPercent ?? 90
  return `pending prompt needs ~${formatTokens(contextFit.usedTokens)} tokens; choose a model under ${threshold}% or use /compact.`
}

function contextFitLabel(
  provider: ProviderId,
  model: string,
  baseLabel: string,
  contextFit?: ModelPickerContextFit | null,
): string {
  if (!contextFit) return baseLabel
  const info = contextWindowInfo(provider, model)
  const percent = info.tokens > 0 ? Math.round((contextFit.usedTokens / info.tokens) * 100) : 0
  return `${baseLabel}  ${formatContextWindow(info.tokens)} ctx ${percent}%`
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return Number.isInteger(millions) ? `${millions}m` : `${millions.toFixed(1)}m`
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

async function loadHfPickerModels(): Promise<ModelPickerOptionsData['hfModels']> {
  const installed = await loadLocalHfModels()
  return installed.map(model => ({
    id: model.id,
    displayName: model.displayName,
    sizeBytes: model.sizeBytes,
    quantization: model.quantization,
    risk: model.risk,
    task: model.task,
    status: model.status,
  }))
}

async function probeLlamaCpp(): Promise<ModelPickerOptionsData['llamaCpp']> {
  try {
    const status = await detectLlamaCpp()
    return {
      binaryPresent: status.binaryPresent,
      serverUp: status.serverUp,
    }
  } catch (err: unknown) {
    return { binaryPresent: false, serverUp: false, error: (err as Error).message }
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'size unknown'
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

function riskColor(risk: string): string {
  if (risk === 'high') return '#e87070'
  if (risk === 'medium') return theme.dim
  return theme.accentSecondary
}

function fitColor(fit: GgufMachineFit): string {
  if (fit === 'too-large') return '#e87070'
  if (fit === 'tight') return theme.accentWarm
  return theme.dim
}

function fitLabel(fit: GgufMachineFit, recommended: boolean): string {
  if (recommended && fit !== 'too-large') return 'recommended for this machine'
  if (recommended) return 'best match found; may be too large'
  return fileFitHint(fit)
}

function fileFitHint(fit: GgufMachineFit): string {
  switch (fit) {
    case 'fits': return 'fits this machine'
    case 'tight': return 'may be slow or tight on memory'
    case 'too-large': return 'likely too large for this machine'
    case 'unknown': return 'machine fit unknown'
  }
}

function formatSignals(downloads: number | undefined, likes: number | undefined): string {
  const d = downloads == null ? 'downloads unknown' : `${downloads} downloads`
  const l = likes == null ? 'likes unknown' : `${likes} likes`
  return `${d}, ${l}`
}

function friendlyFileName(filename: string): string {
  return filename.split('/').pop() ?? filename
}

function safetyLabel(risk: HfRisk): string {
  if (risk === 'low') return 'reviewed'
  if (risk === 'medium') return 'needs review'
  return 'blocked'
}

function credibilityLabel(credibility: HfCredibility): string {
  if (credibility === 'established') return 'established'
  if (credibility === 'normal') return 'some signals'
  return 'limited signals'
}

function friendlyReasons(reasons: string[]): string[] {
  return reasons.map(reason => {
    if (reason.includes('compatible local model file')) return 'compatible local model file'
    if (reason.includes('selected file is not compatible')) return 'file is not compatible with local chat'
    if (reason.includes('revision is mutable')) return 'model link may point to changing files'
    if (reason.includes('license is missing')) return 'license is missing'
    if (reason.includes('limited public usage signals')) return 'source has limited public usage'
    if (reason.includes('pickle/bin')) return 'repo also contains risky model file formats'
    return reason
  })
}

function providerKeyPlaceholder(provider: ProviderId): string {
  if (provider === 'openai') return 'sk-...'
  if (provider === 'anthropic') return 'sk-ant-...'
  if (provider === 'gemini') return 'AIza...'
  return ''
}

function runnerPathPlaceholder(): string {
  if (process.platform === 'win32') return 'C:\\path\\to\\llama-server.exe'
  return '/path/to/llama-server'
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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

const ElapsedSpinner: React.FC<{ startedAt: number; label: string }> = ({ startedAt, label }) => {
  return <Spinner label={label} startedAt={startedAt} />
}
