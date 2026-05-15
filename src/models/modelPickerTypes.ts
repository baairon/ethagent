import type { EthagentConfig, ProviderId } from '../storage/config.js'
import type {
  LlamaCppInstallProgress,
  LlamaCppInstallResult,
  LlamaCppStartResult,
} from './llamacpp.js'
import type {
  HfDownloadPlan,
  HfDownloadProgress,
  HuggingFaceRepoInfo,
  HuggingFaceSibling,
  LocalHfModel,
} from './huggingface.js'
import type {
  CloudProviderId,
  ModelPickerContextFit,
  ModelPickerOptionsData,
} from './modelPickerOptions.js'

export type ModelPickerSelection =
  | { kind: 'llamacpp'; model: string; mmprojPath?: string }
  | { kind: 'cloud'; provider: CloudProviderId; model: string; keyJustSet: boolean }

export type ModelPickerProps = {
  currentConfig: EthagentConfig
  currentProvider: ProviderId
  currentModel: string
  contextFit?: ModelPickerContextFit | null
  featuredHfRepo?: string
  localOnly?: boolean
  onPick: (selection: ModelPickerSelection) => void
  onCancel: () => void
}

export type LoadedModelPickerData = ModelPickerOptionsData
export type LocalUninstallTarget = { kind: 'hf'; id: string; displayName: string; sizeBytes: number }

export type ModelPickerState =
  | { kind: 'loading' }
  | { kind: 'list'; data: LoadedModelPickerData }
  | { kind: 'localCatalogLoading'; data: LoadedModelPickerData }
  | { kind: 'localCatalog'; data: LoadedModelPickerData; catalog: import('./uncensoredCatalog.js').UncensoredCatalogEntry[] }
  | { kind: 'localCatalogError'; data: LoadedModelPickerData; message: string }
  | { kind: 'catalog'; provider: CloudProviderId; data: LoadedModelPickerData }
  | { kind: 'keyEntry'; provider: CloudProviderId; action: 'set' | 'edit'; data: LoadedModelPickerData; submitting: boolean; error?: string }
  | { kind: 'keyManage'; provider: CloudProviderId; data: LoadedModelPickerData; submitting: boolean; error?: string }
  | { kind: 'oauthManage'; data: LoadedModelPickerData; submitting: boolean; error?: string }
  | { kind: 'oauthLogin'; data: LoadedModelPickerData; phase: 'waiting' | 'exchanging' | 'error'; url?: string; message?: string }
  | { kind: 'hfInput'; data: LoadedModelPickerData; error?: string }
  | { kind: 'hfLoading'; data: LoadedModelPickerData; input: string }
  | { kind: 'hfFilePick'; data: LoadedModelPickerData; input: string; repo: HuggingFaceRepoInfo; files: HuggingFaceSibling[] }
  | { kind: 'hfReview'; data: LoadedModelPickerData; plan: HfDownloadPlan }
  | { kind: 'hfDownloading'; data: LoadedModelPickerData; plan: HfDownloadPlan; progress: HfDownloadProgress }
  | { kind: 'hfDone'; data: LoadedModelPickerData; model: LocalHfModel; alreadyInstalled?: boolean }
  | { kind: 'hfError'; data: LoadedModelPickerData; message: string; input?: string }
  | { kind: 'localUninstallPick'; data: LoadedModelPickerData }
  | { kind: 'localUninstallConfirm'; data: LoadedModelPickerData; target: LocalUninstallTarget }
  | { kind: 'localUninstalling'; data: LoadedModelPickerData; target: LocalUninstallTarget }
  | { kind: 'localUninstallDone'; data: LoadedModelPickerData; modelName: string }
  | { kind: 'localUninstallError'; data: LoadedModelPickerData; target: LocalUninstallTarget; message: string }
  | { kind: 'localRunnerSetup'; data: LoadedModelPickerData; model: LocalHfModel }
  | { kind: 'localRunnerInstalling'; data: LoadedModelPickerData; model: LocalHfModel; startedAt: number; progress: LlamaCppInstallProgress }
  | { kind: 'localRunnerInstallFail'; data: LoadedModelPickerData; model: LocalHfModel; result: Extract<LlamaCppInstallResult, { ok: false }> }
  | { kind: 'localRunnerPathEntry'; data: LoadedModelPickerData; model: LocalHfModel; submitting: boolean; error?: string }
  | { kind: 'localRunnerStarting'; data: LoadedModelPickerData; model: LocalHfModel; startedAt: number }
  | { kind: 'localRunnerStartFail'; data: LoadedModelPickerData; model: LocalHfModel; result: Extract<LlamaCppStartResult, { ok: false }> }
  | { kind: 'mmprojOffer'; data: LoadedModelPickerData; model: LocalHfModel }
  | { kind: 'mmprojDownloading'; data: LoadedModelPickerData; model: LocalHfModel; progress: HfDownloadProgress }
  | { kind: 'mmprojError'; data: LoadedModelPickerData; model: LocalHfModel; message: string }
