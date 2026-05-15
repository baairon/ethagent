import { defaultBaseUrlFor, type EthagentConfig } from '../storage/config.js'
import type { ModelPickerSelection } from '../models/ModelPicker.js'

export function configFromModelPickerSelection(selection: ModelPickerSelection, base: EthagentConfig): EthagentConfig {
  if (selection.kind === 'llamacpp') {
    return {
      ...base,
      provider: 'llamacpp',
      model: selection.model,
      baseUrl: defaultBaseUrlFor('llamacpp'),
      localMmprojPath: selection.mmprojPath,
    }
  }
  return {
    ...base,
    provider: selection.provider,
    model: selection.model,
    baseUrl: undefined,
    localMmprojPath: undefined,
  }
}

export function formatGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  return gb < 10 ? `${gb.toFixed(1)}GB` : `${Math.round(gb)}GB`
}
