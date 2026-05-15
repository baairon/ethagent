import type {
  LlamaCppInstallProgress,
  LlamaCppInstallResult,
  LlamaCppStartResult,
} from './llamacpp.js'
import {
  installLlamaCppRunner,
  setLlamaCppServerPath,
  startLlamaCppServer,
} from './llamacpp.js'
import type { LocalHfModel } from './huggingface.js'
import type { ModelPickerSelection, ModelPickerState as State } from './modelPickerTypes.js'
import { loadHfPickerModels, probeLlamaCpp } from './modelPickerData.js'
export function localRunnerStartFailureSubtitle(result: Extract<LlamaCppStartResult, { ok: false }>): string {
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

export async function startAndPickHfModel(
  model: LocalHfModel,
  state: Extract<State, { kind: 'list' | 'localCatalog' | 'hfDone' | 'mmprojOffer' | 'mmprojError' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  if (model.risk === 'high') {
    setState({ kind: 'hfError', data: state.data, message: 'blocked high-risk model; choose a model from a more credible source' })
    return
  }
  if (model.mmprojAvailable && !model.mmprojPath && state.kind !== 'mmprojOffer' && state.kind !== 'mmprojError') {
    setState({ kind: 'mmprojOffer', data: state.data, model })
    return
  }
  setState({ kind: 'localRunnerStarting', data: state.data, model, startedAt: Date.now() })
  const result = await startLlamaCppServer({
    modelPath: model.localPath,
    modelAlias: model.id,
    mmprojPath: model.mmprojPath,
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
  onPick({ kind: 'llamacpp', model: model.id, mmprojPath: model.mmprojPath })
}

export async function installRunnerAndStart(
  state: Extract<State, { kind: 'localRunnerSetup' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  await runRunnerSetup(state, setState, onPick, installLlamaCppRunner)
}

export async function runRunnerSetup(
  state: Extract<State, { kind: 'localRunnerSetup' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
  setup: (onProgress?: (progress: LlamaCppInstallProgress) => void) => Promise<LlamaCppInstallResult>,
): Promise<void> {
  const startedAt = Date.now()
  const initialProgress: LlamaCppInstallProgress = {
    phase: 'checking',
    label: 'preparing local runner...',
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

export async function saveRunnerPathAndStart(
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
