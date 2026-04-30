import {
  startLlamaCppServer,
  type LlamaCppStartFailureCode,
  type LlamaCppStartResult,
} from './llamacpp.js'
import { findLocalHfModel, type LocalHfModel } from './huggingface.js'
import { localProviderBaseUrlFor, type EthagentConfig } from '../storage/config.js'
import { formatModelDisplayName } from './modelDisplay.js'

export type LlamaCppPreflightResult =
  | { ok: true; alreadyRunning: boolean }
  | {
      ok: false
      code: LlamaCppStartFailureCode
      message: string
      detail?: string
      servedModels?: string[]
    }

export type LlamaCppPreflightDeps = {
  fetchImpl?: typeof fetch
  findLocalModel?: typeof findLocalHfModel
  startServer?: typeof startLlamaCppServer
  timeoutMs?: number
}

type ModelsProbe =
  | { up: true; models: string[] }
  | { up: false; models: [] }

export async function ensureLlamaCppRunnerReady(
  config: EthagentConfig,
  deps: LlamaCppPreflightDeps = {},
): Promise<LlamaCppPreflightResult> {
  if (config.provider !== 'llamacpp') return { ok: true, alreadyRunning: true }

  const baseUrl = localProviderBaseUrlFor('llamacpp', config.baseUrl)
  const local = await (deps.findLocalModel ?? findLocalHfModel)(config.model)
  if (!local || local.status !== 'ready') {
    return {
      ok: false,
      code: 'model-file-missing',
      message: formatPreflightFailure(
        'local model is not imported',
        config.model,
        'choose an imported Hugging Face GGUF model from view full catalog or add a local model file',
      ),
    }
  }

  const probe = await probeLlamaCppModels(baseUrl, deps)
  if (probe.up) {
    if (probe.models.length === 0 || probe.models.includes(config.model)) {
      return { ok: true, alreadyRunning: true }
    }
    return {
      ok: false,
      code: 'different-model-running',
      message: formatPreflightFailure(
        'local runner is serving a different model',
        config.model,
        `a different local model is already running (${probe.models.join(', ')}); stop it before switching models`,
      ),
      servedModels: probe.models,
    }
  }

  const result = await (deps.startServer ?? startLlamaCppServer)({
    modelPath: local.localPath,
    modelAlias: local.id,
    host: llamaCppServerHostFromBaseUrl(baseUrl),
  })
  if (result.ok) return { ok: true, alreadyRunning: result.alreadyRunning }
  return withPreflightMessage(result, local)
}

export async function probeLlamaCppModels(
  baseUrl: string,
  deps: Pick<LlamaCppPreflightDeps, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<ModelsProbe> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 800)
  try {
    const response = await (deps.fetchImpl ?? fetch)(llamaCppModelsEndpointForBaseUrl(baseUrl), {
      signal: controller.signal,
    })
    if (!response.ok) return { up: false, models: [] }
    const data = await response.json() as { data?: Array<{ id?: unknown }> }
    return {
      up: true,
      models: (data.data ?? [])
        .map(item => typeof item.id === 'string' ? item.id : '')
        .filter(Boolean),
    }
  } catch {
    return { up: false, models: [] }
  } finally {
    clearTimeout(timer)
  }
}

export function llamaCppModelsEndpointForBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = stripTrailingSlash(url.pathname)
  url.pathname = path.endsWith('/v1') ? `${path}/models` : `${path}/v1/models`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function llamaCppServerHostFromBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = stripTrailingSlash(url.pathname)
  url.pathname = path.endsWith('/v1') ? stripTrailingSlash(path.slice(0, -3)) || '/' : path || '/'
  url.search = ''
  url.hash = ''
  return stripTrailingSlash(url.toString())
}

function withPreflightMessage(
  result: Extract<LlamaCppStartResult, { ok: false }>,
  local: LocalHfModel,
): Extract<LlamaCppPreflightResult, { ok: false }> {
  return {
    ok: false,
    code: result.code,
    message: formatPreflightFailure(
      'local runner is not reachable',
      local.id,
      result.message,
      local.displayName,
    ),
    detail: result.detail,
    servedModels: result.servedModels,
  }
}

function formatPreflightFailure(
  prefix: string,
  modelId: string,
  reason: string,
  displayName?: string,
): string {
  const model = formatModelDisplayName('llamacpp', modelId, { displayName, maxLength: 64 })
  return `${prefix}; failed to start ${model}: ${reason}`
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
