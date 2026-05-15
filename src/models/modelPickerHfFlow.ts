import React from 'react'
import {
  addMmprojToInstalledModel,
  createHfDownloadPlan,
  downloadHfModel,
  fetchHuggingFaceRepoInfo,
  findLocalHfModel,
  ggufFiles,
  loadLocalHfModels,
  modelFromPlan,
  parseHuggingFaceRef,
  type HuggingFaceRepoInfo,
  type HuggingFaceSibling,
  type LocalHfModel,
} from './huggingface.js'
import { stopLlamaCppServer } from './llamacpp.js'
import { orderGgufFilesForSpec, recommendGgufFile } from './modelRecommendation.js'
import type { SpecSnapshot } from './runtimeDetection.js'
import type { ModelPickerSelection, ModelPickerState as State } from './modelPickerTypes.js'
import { loadHfPickerModels } from './modelPickerData.js'
import { startAndPickHfModel } from './modelPickerLocalRunnerFlow.js'
export async function findInstalledHfModelForInput(input: string): Promise<LocalHfModel | null> {
  const ref = parseHuggingFaceRef(input)
  const installed = await loadLocalHfModels()
  return installed.find(model =>
    model.status === 'ready'
    && model.repoId === ref.repoId
    && (!ref.filename || model.filename === ref.filename)
  ) ?? null
}

export function chooseInstalledHfModelForRepo(
  installed: LocalHfModel[],
  repo: HuggingFaceRepoInfo,
  files: HuggingFaceSibling[],
  requestedFilename: string | undefined,
  spec: SpecSnapshot | undefined,
): LocalHfModel | null {
  const compatibleFiles = new Set(files.map(file => file.filename))
  const candidates = installed.filter(model =>
    model.status === 'ready'
    && model.repoId === repo.repoId
    && compatibleFiles.has(model.filename)
    && (!requestedFilename || model.filename === requestedFilename)
  )
  if (requestedFilename || candidates.length <= 1) return candidates[0] ?? null

  const orderedFiles = spec
    ? orderGgufFilesForSpec(repo, files, spec).map(item => item.file.filename)
    : files.map(file => file.filename)
  for (const filename of orderedFiles) {
    const match = candidates.find(model => model.filename === filename)
    if (match) return match
  }
  return candidates[0] ?? null
}

export async function inspectHfInput(
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
    const installed = chooseInstalledHfModelForRepo(
      await loadLocalHfModels(),
      repo,
      files,
      ref.filename,
      state.data.machineSpec,
    )
    if (installed) {
      setState({
        kind: 'hfDone',
        data: { ...state.data, hfModels: await loadHfPickerModels() },
        model: installed,
        alreadyInstalled: true,
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

export async function reviewHfFile(
  state: Extract<State, { kind: 'hfFilePick' }>,
  filename: string,
  setState: (s: State) => void,
): Promise<void> {
  setState({ kind: 'hfLoading', data: state.data, input: state.input })
  try {
    const installed = chooseInstalledHfModelForRepo(
      await loadLocalHfModels(),
      state.repo,
      state.files,
      filename,
      state.data.machineSpec,
    )
    if (installed) {
      setState({
        kind: 'hfDone',
        data: { ...state.data, hfModels: await loadHfPickerModels() },
        model: installed,
        alreadyInstalled: true,
      })
      return
    }
    const plan = await createHfDownloadPlan(state.input, filename)
    setState({ kind: 'hfReview', data: state.data, plan })
  } catch (err: unknown) {
    setState({ kind: 'hfError', data: state.data, message: (err as Error).message, input: state.input })
  }
}

export async function startHfDownload(
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

export async function downloadMmprojAndContinue(
  state: Extract<State, { kind: 'mmprojOffer' }>,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  setState({ kind: 'mmprojDownloading', data: state.data, model: state.model, progress: { status: 'starting' } })
  try {
    for await (const progress of addMmprojToInstalledModel(state.model.id)) {
      setState({ kind: 'mmprojDownloading', data: state.data, model: state.model, progress })
    }
  } catch (err: unknown) {
    setState({ kind: 'mmprojError', data: state.data, model: state.model, message: (err as Error).message })
    return
  }
  const updated = await findLocalHfModel(state.model.id)
  if (!updated || !updated.mmprojPath) {
    setState({ kind: 'mmprojError', data: state.data, model: state.model, message: 'projector downloaded but path was not persisted' })
    return
  }
  await stopLlamaCppServer().catch(() => null)
  const data = { ...state.data, hfModels: await loadHfPickerModels() }
  await startAndPickHfModel(updated, { kind: 'mmprojOffer', data, model: updated }, setState, onPick)
}
