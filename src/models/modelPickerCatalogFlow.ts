import { createHfDownloadPlan, ggufFiles, loadLocalHfModels } from './huggingface.js'
import { fetchUncensoredGgufCatalog, type UncensoredCatalogEntry } from './uncensoredCatalog.js'
import { chooseInstalledHfModelForRepo } from './modelPickerHfFlow.js'
import { loadHfPickerModels } from './modelPickerData.js'
import type { LoadedModelPickerData as LoadedData, ModelPickerState as State } from './modelPickerTypes.js'

export async function openLocalCatalog(
  data: LoadedData,
  setState: (s: State) => void,
): Promise<void> {
  setState({ kind: 'localCatalogLoading', data })
  try {
    const installedModels = await loadLocalHfModels()
    const catalog = await fetchUncensoredGgufCatalog({
      machineSpec: data.machineSpec,
      installedModels,
    })
    setState({
      kind: 'localCatalog',
      data: { ...data, hfModels: await loadHfPickerModels() },
      catalog,
    })
  } catch (err: unknown) {
    setState({ kind: 'localCatalogError', data, message: (err as Error).message })
  }
}

export async function reviewCatalogModel(
  state: Extract<State, { kind: 'localCatalog' }>,
  entry: UncensoredCatalogEntry,
  setState: (s: State) => void,
): Promise<void> {
  const files = ggufFiles(entry.repo)
  const installed = chooseInstalledHfModelForRepo(
    await loadLocalHfModels(),
    entry.repo,
    files,
    entry.file.filename,
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
  try {
    const plan = await createHfDownloadPlan(entry.repo.repoId, entry.file.filename)
    setState({ kind: 'hfReview', data: state.data, plan })
  } catch (err: unknown) {
    setState({ kind: 'hfError', data: state.data, message: (err as Error).message, input: entry.repo.repoId })
  }
}
