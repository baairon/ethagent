import { detectLlamaCpp } from './llamacpp.js'
import { backfillMmprojForModels, loadLocalHfModels } from './huggingface.js'
import type { LoadedModelPickerData } from './modelPickerTypes.js'
import type { ModelPickerOptionsData } from './modelPickerOptions.js'

export async function loadHfPickerModels(): Promise<ModelPickerOptionsData['hfModels']> {
  const installed = await loadLocalHfModels()
  const backfilled = await backfillMmprojForModels(installed)
  return backfilled.map(model => ({
    id: model.id,
    displayName: model.displayName,
    sizeBytes: model.sizeBytes,
    quantization: model.quantization,
    risk: model.risk,
    task: model.task,
    status: model.status,
    mmprojPath: model.mmprojPath,
    mmprojAvailable: model.mmprojAvailable,
    mmprojSizeBytes: model.mmprojSizeBytes,
  }))
}

export async function probeLlamaCpp(): Promise<ModelPickerOptionsData['llamaCpp']> {
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

export async function refreshLocalModelData(data: LoadedModelPickerData): Promise<LoadedModelPickerData> {
  const hfModels = await loadHfPickerModels()
  return {
    ...data,
    hfModels,
  }
}
