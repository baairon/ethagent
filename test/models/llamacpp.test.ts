import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import {
  humanInstallError,
  llamaCppInstallPlans,
  llamaCppSearchRoots,
  llamaCppServerCandidates,
  startLlamaCppServer,
  stopLlamaCppServer,
  summarizeInstallOutput,
} from '../../src/models/llamacpp.js'

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
  let spawnArgs: string[] = []
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
        spawnImpl: (_command, args) => {
          spawnArgs = [...args]
          return fakeChild()
        },
      },
    })
    assert.deepEqual(result, { ok: true, alreadyRunning: false })
    assert.ok(spawnArgs.includes('--jinja'))
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

test('startLlamaCppServer appends --mmproj when mmprojPath is provided', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  let spawnArgs: string[] = []
  globalThis.fetch = (async () => {
    calls += 1
    if (calls < 2) return new Response('', { status: 503 })
    return modelsResponse(['vision-model'])
  }) as typeof fetch

  try {
    const result = await startLlamaCppServer({
      modelPath: 'weights.gguf',
      modelAlias: 'vision-model',
      mmprojPath: 'mmproj.gguf',
      host: 'http://127.0.0.1:18091',
      readinessTimeoutMs: 100,
      pollMs: 1,
      deps: {
        access: async () => undefined,
        binaryPath: 'llama-server',
        spawnImpl: (_command, args) => {
          spawnArgs = [...args]
          return fakeChild()
        },
      },
    })
    assert.equal(result.ok, true)
    const mmprojIndex = spawnArgs.indexOf('--mmproj')
    assert.notEqual(mmprojIndex, -1)
    assert.equal(spawnArgs[mmprojIndex + 1], 'mmproj.gguf')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer omits --mmproj when mmprojPath is not provided', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  let spawnArgs: string[] = []
  globalThis.fetch = (async () => {
    calls += 1
    if (calls < 2) return new Response('', { status: 503 })
    return modelsResponse(['text-model'])
  }) as typeof fetch

  try {
    await startLlamaCppServer({
      modelPath: 'weights.gguf',
      modelAlias: 'text-model',
      host: 'http://127.0.0.1:18092',
      readinessTimeoutMs: 100,
      pollMs: 1,
      deps: {
        access: async () => undefined,
        binaryPath: 'llama-server',
        spawnImpl: (_command, args) => {
          spawnArgs = [...args]
          return fakeChild()
        },
      },
    })
    assert.equal(spawnArgs.includes('--mmproj'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('startLlamaCppServer reports missing mmproj file before spawning', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch

  try {
    const result = await startLlamaCppServer({
      modelPath: 'weights.gguf',
      modelAlias: 'vision-model',
      mmprojPath: '/missing/mmproj.gguf',
      host: 'http://127.0.0.1:18093',
      readinessTimeoutMs: 100,
      pollMs: 1,
      deps: {
        access: async (target) => {
          if (target === '/missing/mmproj.gguf') throw new Error('ENOENT')
          return undefined
        },
        binaryPath: 'llama-server',
        spawnImpl: () => { throw new Error('should not spawn') },
      },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'model-file-missing')
    assert.equal(result.detail, '/missing/mmproj.gguf')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('stopLlamaCppServer is a no-op when no pid file exists and no server is up', async () => {
  await withTempEthagentHome(async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
    let killCalls = 0
    try {
      const result = await stopLlamaCppServer({
        host: 'http://127.0.0.1:18100',
        killImpl: () => { killCalls += 1 },
      })
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.stopped, false)
      assert.equal(result.reason, undefined)
      assert.equal(killCalls, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('stopLlamaCppServer reads the pid, sends SIGTERM, and clears the file', async () => {
  await withTempEthagentHome(async () => {
    const path = await import('node:path')
    const pidPath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? os.tmpdir(), '.ethagent', 'llamacpp.pid')
    await fs.mkdir(path.dirname(pidPath), { recursive: true })
    await fs.writeFile(pidPath, '12345', 'utf8')

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => modelsResponse([])) as typeof fetch
    const seenPids: number[] = []
    try {
      const result = await stopLlamaCppServer({
        host: 'http://127.0.0.1:18099',
        timeoutMs: 200,
        pollMs: 10,
        killImpl: pid => { seenPids.push(pid) },
      })
      assert.deepEqual(result, { ok: true, stopped: true })
      assert.deepEqual(seenPids, [12345])
      await assert.rejects(fs.stat(pidPath), { code: 'ENOENT' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('stopLlamaCppServer reports untracked-server when alias is served but no pid file exists', async () => {
  await withTempEthagentHome(async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => modelsResponse(['some-orphan-model'])) as typeof fetch
    try {
      const result = await stopLlamaCppServer({ host: 'http://127.0.0.1:18101' })
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.stopped, false)
      assert.equal(result.reason, 'untracked-server')
      assert.deepEqual(result.servedModels, ['some-orphan-model'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('startLlamaCppServer reports a held port when mmprojPath is set but the server cannot be drained', async () => {
  await withTempEthagentHome(async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => modelsResponse(['wanted-model'])) as typeof fetch
    try {
      const result = await startLlamaCppServer({
        modelPath: 'weights.gguf',
        modelAlias: 'wanted-model',
        mmprojPath: '/tmp/mmproj.gguf',
        host: 'http://127.0.0.1:18102',
      })
      assert.equal(result.ok, false)
      if (result.ok) return
      assert.equal(result.code, 'different-model-running')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('startLlamaCppServer still returns alreadyRunning without mmprojPath even when pid file is missing', async () => {
  await withTempEthagentHome(async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => modelsResponse(['wanted-model'])) as typeof fetch
    try {
      const result = await startLlamaCppServer({
        modelPath: 'weights.gguf',
        modelAlias: 'wanted-model',
        host: 'http://127.0.0.1:18103',
      })
      assert.deepEqual(result, { ok: true, alreadyRunning: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('stopLlamaCppServer handles ESRCH by clearing the stale pid file', async () => {
  await withTempEthagentHome(async () => {
    const path = await import('node:path')
    const pidPath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? os.tmpdir(), '.ethagent', 'llamacpp.pid')
    await fs.mkdir(path.dirname(pidPath), { recursive: true })
    await fs.writeFile(pidPath, '99999', 'utf8')

    const result = await stopLlamaCppServer({
      killImpl: () => {
        const err: NodeJS.ErrnoException = new Error('No such process')
        err.code = 'ESRCH'
        throw err
      },
    })
    assert.deepEqual(result, { ok: true, stopped: false })
    await assert.rejects(fs.stat(pidPath), { code: 'ENOENT' })
  })
})

async function withTempEthagentHome(fn: () => Promise<void>): Promise<void> {
  const tmp = await fs.mkdtemp(`${os.tmpdir()}/ethagent-llamacpp-`)
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  process.env.HOME = tmp
  process.env.USERPROFILE = tmp
  try {
    await fn()
  } finally {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

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
