import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runResetCommand } from '../src/cli/reset.js'
import {
  createFactoryResetPlan,
  runFactoryReset,
} from '../src/storage/factoryReset.js'

test('factory reset deletes local ethagent data while preserving installed local model assets', async () => {
  await withHome(async home => {
    const root = path.join(home, '.ethagent')
    await seedResetFixture(root)

    const plan = await createFactoryResetPlan()
    assert.ok(plan.deletePaths.some(item => item.endsWith('config.json')))
    assert.ok(plan.deletePaths.some(item => item.endsWith('continuity')))
    assert.ok(plan.deletePaths.some(item => item.endsWith('sessions')))
    assert.ok(plan.preservedPaths.some(item => item.endsWith('models')))
    assert.ok(plan.preservedPaths.some(item => item.endsWith('local-models.json')))
    assert.ok(plan.preservedPaths.some(item => item.endsWith('runners')))
    assert.ok(plan.preservedPaths.some(item => item.endsWith('local-runner.json')))

    const result = await runFactoryReset({ clearSecrets: false })
    assert.ok(result.deletedPaths.length >= 7)
    await assertMissing(path.join(root, 'config.json'))
    await assertMissing(path.join(root, 'sessions'))
    await assertMissing(path.join(root, 'continuity'))
    await assertMissing(path.join(root, 'history.jsonl'))
    await assertMissing(path.join(root, 'rewind.jsonl'))
    await assertMissing(path.join(root, 'permissions.json'))
    await assertMissing(path.join(root, 'keys.enc'))

    await assertExists(path.join(root, 'models', 'huggingface', 'model.gguf'))
    await assertExists(path.join(root, 'local-models.json'))
    await assertExists(path.join(root, 'runners', 'llama.cpp', 'build', 'llama-server.exe'))
    await assertExists(path.join(root, 'local-runner.json'))
  })
})

test('ethagent reset requires confirm by default and supports --yes for automation', async () => {
  await withHome(async home => {
    const root = path.join(home, '.ethagent')
    await seedResetFixture(root)
    const deniedOutput: string[] = []

    const denied = await runResetCommand([], {
      write: text => { deniedOutput.push(text) },
      writeError: text => { deniedOutput.push(text) },
      readConfirmation: async () => 'no',
    })

    assert.equal(denied, 1)
    assert.match(deniedOutput.join(''), /type confirm/)
    assert.match(deniedOutput.join(''), /factory reset cancelled/)
    await assertExists(path.join(root, 'config.json'))

    const allowedOutput: string[] = []
    const allowed = await runResetCommand(['--yes'], {
      write: text => { allowedOutput.push(text) },
      writeError: text => { allowedOutput.push(text) },
      clearSecrets: false,
    })

    assert.equal(allowed, 0)
    assert.match(allowedOutput.join(''), /factory reset complete/)
    assert.match(allowedOutput.join(''), /local LLM assets/)
    await assertMissing(path.join(root, 'config.json'))
    await assertExists(path.join(root, 'models', 'huggingface', 'model.gguf'))
  })
})

async function seedResetFixture(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'sessions'), { recursive: true })
  await fs.mkdir(path.join(root, 'continuity', '1-registry-token'), { recursive: true })
  await fs.mkdir(path.join(root, 'models', 'huggingface'), { recursive: true })
  await fs.mkdir(path.join(root, 'runners', 'llama.cpp', 'build'), { recursive: true })
  await fs.mkdir(path.join(root, 'pastes'), { recursive: true })
  await fs.writeFile(path.join(root, 'config.json'), '{}\n', 'utf8')
  await fs.writeFile(path.join(root, 'sessions', 'one.jsonl'), '{}\n', 'utf8')
  await fs.writeFile(path.join(root, 'continuity', '1-registry-token', 'MEMORY.md'), '# Memory\n', 'utf8')
  await fs.writeFile(path.join(root, 'history.jsonl'), '{}\n', 'utf8')
  await fs.writeFile(path.join(root, 'rewind.jsonl'), '{}\n', 'utf8')
  await fs.writeFile(path.join(root, 'permissions.json'), '[]\n', 'utf8')
  await fs.writeFile(path.join(root, 'keys.enc'), '{}\n', 'utf8')
  await fs.writeFile(path.join(root, '.salt'), 'salt\n', 'utf8')
  await fs.writeFile(path.join(root, 'pastes', 'one.txt'), 'paste\n', 'utf8')
  await fs.writeFile(path.join(root, 'models', 'huggingface', 'model.gguf'), 'model\n', 'utf8')
  await fs.writeFile(path.join(root, 'local-models.json'), '[]\n', 'utf8')
  await fs.writeFile(path.join(root, 'runners', 'llama.cpp', 'build', 'llama-server.exe'), 'runner\n', 'utf8')
  await fs.writeFile(path.join(root, 'local-runner.json'), '{}\n', 'utf8')
}

async function assertExists(target: string): Promise<void> {
  await fs.access(target)
}

async function assertMissing(target: string): Promise<void> {
  await assert.rejects(() => fs.access(target), /ENOENT/)
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-reset-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn(home)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    await fs.rm(home, { recursive: true, force: true })
  }
}
