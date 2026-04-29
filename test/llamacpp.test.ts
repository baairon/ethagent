import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import {
  humanInstallError,
  llamaCppInstallPlans,
  llamaCppSearchRoots,
  llamaCppServerCandidates,
  startLlamaCppServer,
  summarizeInstallOutput,
} from '../src/bootstrap/llamacpp.js'

test('llama.cpp runner discovery checks explicit paths before PATH', () => {
  const candidates = llamaCppServerCandidates({
    LLAMA_SERVER_PATH: 'C:\\tools\\llama-server.exe',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    USERPROFILE: 'C:\\Users\\me',
  }, 'win32')

  assert.equal(candidates[0], 'C:\\tools\\llama-server.exe')
  assert.ok(candidates.includes('llama-server'))
  assert.ok(candidates.includes('llama-server.exe'))
  assert.ok(candidates.some(candidate => candidate.endsWith('Programs\\llama.cpp\\llama-server.exe')))
})

test('llama.cpp search roots include package-manager install locations', () => {
  const roots = llamaCppSearchRoots({
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    USERPROFILE: 'C:\\Users\\me',
  }, 'win32')

  assert.ok(roots.includes('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages'))
  assert.ok(roots.includes('C:\\Program Files\\WindowsApps'))
  assert.ok(roots.includes('C:\\Users\\me\\scoop\\apps\\llama.cpp'))
})

test('llama.cpp install errors are summarized for picker UI', () => {
  const summary = summarizeInstallOutput([
    '',
    '-------------------------',
    '  1.0 MB / 2.0 MB',
    'Found llama.cpp',
    'Installer failed because the package did not expose llama-server',
  ].join('\n'))

  assert.equal(summary, 'Found llama.cpp\nInstaller failed because the package did not expose llama-server')
  assert.equal(
    humanInstallError({ label: 'winget llama.cpp', command: 'winget', args: [] }, 2316632107),
    'Windows could not install the local runner automatically.',
  )
})

test('llama.cpp install plans cover popular desktop operating systems', () => {
  assert.deepEqual(llamaCppInstallPlans('win32')[0], {
    label: 'winget llama.cpp',
    command: 'winget',
    args: ['install', 'llama.cpp', '--accept-source-agreements', '--accept-package-agreements'],
  })
  assert.equal(llamaCppInstallPlans('darwin')[0]?.command, 'brew')
  assert.equal(llamaCppInstallPlans('darwin')[1]?.command, 'nix')
  assert.equal(llamaCppInstallPlans('darwin')[2]?.command, 'port')
  assert.equal(llamaCppInstallPlans('linux')[0]?.command, 'brew')
  assert.equal(llamaCppInstallPlans('linux')[1]?.command, 'nix')
})

test('startLlamaCppServer accepts an already-running requested model', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = modelsFetch(['wanted-model'])

  try {
    const result = await startLlamaCppServer({
      modelPath: 'missing-file.gguf',
      modelAlias: 'wanted-model',
      host: 'http://127.0.0.1:18080',
    })
    assert.deepEqual(result, { ok: true, alreadyRunning: true })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer refuses to switch when another model is already served', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = modelsFetch(['other-model'])

  try {
    const result = await startLlamaCppServer({
      modelPath: 'missing-file.gguf',
      modelAlias: 'wanted-model',
      host: 'http://127.0.0.1:18080',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'different-model-running')
    assert.match(result.message, /already running/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer waits through slow local runner startup', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (calls < 3) return new Response('', { status: 503 })
    return modelsResponse(['wanted-model'])
  }) as typeof fetch

  try {
    const result = await startLlamaCppServer({
      modelPath: 'model.gguf',
      modelAlias: 'wanted-model',
      host: 'http://127.0.0.1:18081',
      readinessTimeoutMs: 100,
      pollMs: 1,
      deps: {
        access: async () => undefined,
        binaryPath: 'llama-server',
        spawnImpl: () => fakeChild(),
      },
    })
    assert.deepEqual(result, { ok: true, alreadyRunning: false })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer returns readiness-timeout when runner keeps loading', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch

  try {
    const result = await startLlamaCppServer({
      modelPath: 'model.gguf',
      modelAlias: 'wanted-model',
      host: 'http://127.0.0.1:18082',
      readinessTimeoutMs: 3,
      pollMs: 1,
      deps: {
        access: async () => undefined,
        binaryPath: 'llama-server',
        spawnImpl: () => fakeChild(),
      },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'readiness-timeout')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer reports spawn failures separately from link errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch

  try {
    const result = await startLlamaCppServer({
      modelPath: 'model.gguf',
      modelAlias: 'wanted-model',
      host: 'http://127.0.0.1:18083',
      readinessTimeoutMs: 100,
      pollMs: 1,
      deps: {
        access: async () => undefined,
        binaryPath: 'llama-server',
        spawnImpl: () => {
          const child = fakeChild()
          queueMicrotask(() => child.emit('error', new Error('spawn denied')))
          return child
        },
      },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'spawn-failed')
    assert.match(result.message, /could not be started/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer reports runner exits before readiness', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch

  try {
    const result = await startLlamaCppServer({
      modelPath: 'model.gguf',
      modelAlias: 'wanted-model',
      host: 'http://127.0.0.1:18084',
      readinessTimeoutMs: 100,
      pollMs: 1,
      deps: {
        access: async () => undefined,
        binaryPath: 'llama-server',
        spawnImpl: () => {
          const child = fakeChild()
          queueMicrotask(() => child.emit('exit', 1, null))
          return child
        },
      },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'runner-exited')
  } finally {
    globalThis.fetch = originalFetch
  }
})

function modelsFetch(models: string[]): typeof fetch {
  return (async () => modelsResponse(models)) as typeof fetch
}

function modelsResponse(models: string[]): Response {
  return new Response(JSON.stringify({
    data: models.map(id => ({ id })),
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeChild(): ReturnType<typeof spawn> {
  const child = new EventEmitter() as ReturnType<typeof spawn>
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    unref: () => child,
    kill: () => true,
  })
  return child
}
