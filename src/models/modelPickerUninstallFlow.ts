import type { ProviderId } from '../storage/config.js'
import { uninstallLocalHfModel } from './huggingface.js'
import { formatLocalHfModelDisplayName } from './modelDisplay.js'
import type { LoadedModelPickerData as LoadedData, LocalUninstallTarget, ModelPickerState as State } from './modelPickerTypes.js'
import { refreshLocalModelData } from './modelPickerData.js'
export function localUninstallTargets(data: LoadedData): LocalUninstallTarget[] {
  return data.hfModels.map(model => ({
    kind: 'hf' as const,
    id: model.id,
    displayName: formatLocalHfModelDisplayName(model.id, {
      displayName: model.displayName,
      maxLength: 64,
    }),
    sizeBytes: model.sizeBytes,
  }))
}

export function isCurrentLocalUninstallTarget(
  target: LocalUninstallTarget,
  currentProvider: ProviderId,
  currentModel: string,
): boolean {
  return target.kind === 'hf' && currentProvider === 'llamacpp' && target.id === currentModel
}

export function localUninstallBoundaryCopy(_target: LocalUninstallTarget): string {
  return 'This removes only the downloaded GGUF file and metadata from this machine.'
}

export async function uninstallLocalModel(
  state: Extract<State, { kind: 'localUninstallConfirm' }>,
  setState: (s: State) => void,
): Promise<void> {
  setState({ kind: 'localUninstalling', data: state.data, target: state.target })
  const modelName = state.target.displayName
  try {
    await uninstallLocalHfModel(state.target.id)
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
