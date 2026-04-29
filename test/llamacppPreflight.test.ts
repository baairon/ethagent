import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  ensureLlamaCppRunnerReady,
  llamaCppModelsEndpointForBaseUrl,
  llamaCppServerHostFromBaseUrl,
} from '../src/ui/llamacppPreflight.js'
import type { LlamaCppStartResult } from '../src/bootstrap/llamacpp.js'
import type { LocalHfModel } from '../src/models/huggingface.js'
import type { EthagentConfig } from '../src/storage/config.js'

const config: EthagentConfig = {
  version: 1,
  provider: 'llamacpp',
  model: 'org/model-GGUF#model.Q4_K_M.gguf',
  baseUrl: 'http://localhost:8080/v1',
  firstRunAt: new Date(0).toISOString(),
}

test('llama.cpp preflight derives /v1/models and runner host from configured base URL', () => {
  assert.equal(
    llamaCppModelsEndpointForBaseUrl('http://localhost:8080/v1'),
    'http://localhost:8080/v1/models',
  )
  assert.equal(
    llamaCppServerHostFromBaseUrl('http://localhost:8080/v1'),
    'http://localhost:8080',
  )
})

test('llama.cpp preflight starts the configured local runner when models endpoint is unreachable', async () => {
  const startArgs: Array<{ modelPath: string; modelAlias: string; host?: string }> = []
  const result = await ensureLlamaCppRunnerReady(config, {
    fetchImpl: failingFetch,
    findLocalModel: async id => localModel({ id }),
    startServer: async args => {
      startArgs.push(args)
      return { ok: true, alreadyRunning: false }
    },
  })

  assert.deepEqual(result, { ok: true, alreadyRunning: false })
  assert.equal(startArgs[0]?.modelPath, path.join('models', 'model.Q4_K_M.gguf'))
  assert.equal(startArgs[0]?.modelAlias, config.model)
  assert.equal(startArgs[0]?.host, 'http://localhost:8080')
})

test('llama.cpp preflight reports missing local model metadata without starting provider', async () => {
  let started = false
  const result = await ensureLlamaCppRunnerReady(config, {
    fetchImpl: failingFetch,
    findLocalModel: async () => null,
    startServer: async () => {
      started = true
      return { ok: true, alreadyRunning: false }
    },
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'model-file-missing')
  assert.match(result.message, /local runner is not reachable/)
  assert.equal(started, false)
})

test('llama.cpp preflight reports runner-not-installed without calling provider', async () => {
  const result = await ensureLlamaCppRunnerReady(config, {
    fetchImpl: failingFetch,
    findLocalModel: async id => localModel({ id }),
    startServer: async () => startFailure('runner-not-installed', 'local model runner is not installed yet'),
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'runner-not-installed')
  assert.match(result.message, /local model runner is not installed/)
})

test('llama.cpp preflight reports different-model-running from /v1/models without starting provider', async () => {
  let started = false
  const result = await ensureLlamaCppRunnerReady(config, {
    fetchImpl: modelsFetch(['other-model']),
    findLocalModel: async id => localModel({ id }),
    startServer: async () => {
      started = true
      return { ok: true, alreadyRunning: false }
    },
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'different-model-running')
  assert.match(result.message, /different local model/)
  assert.equal(started, false)
})

function localModel(overrides: Partial<LocalHfModel> = {}): LocalHfModel {
  return {
    id: 'org/model-GGUF#model.Q4_K_M.gguf',
    provider: 'llamacpp',
    repoId: 'org/model-GGUF',
    requestedRevision: 'main',
    resolvedRevision: '0123456789abcdef0123456789abcdef01234567',
    filename: 'model.Q4_K_M.gguf',
    displayName: 'org/model-GGUF / model.Q4_K_M.gguf',
    localPath: path.join('models', 'model.Q4_K_M.gguf'),
    sizeBytes: 4_200_000_000,
    format: 'gguf',
    runtime: 'llama.cpp runnable',
    task: 'chat/instruct',
    sizeClass: 'small',
    quantization: 'Q4_K_M',
    risk: 'low',
    credibility: 'established',
    reviewedAt: new Date(0).toISOString(),
    installedAt: new Date(0).toISOString(),
    status: 'ready',
    ...overrides,
  }
}

function startFailure(
  code: Extract<LlamaCppStartResult, { ok: false }>['code'],
  message: string,
): LlamaCppStartResult {
  return { ok: false, code, message }
}

function failingFetch(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed'))
}

function modelsFetch(models: string[]): typeof fetch {
  return (async () => new Response(JSON.stringify({
    data: models.map(id => ({ id })),
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch
}
