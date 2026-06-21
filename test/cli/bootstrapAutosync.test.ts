import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { injectManagedBlock, parseManagedContext, renderManagedBlock } from '../../src/cli/syncAdapters/managedBlock.js'
import { claudeCodeAdapter, mergeClaudeHooks, removeClaudeHooks } from '../../src/cli/syncAdapters/claude-code.js'
import { addGenericTarget, genericAdapter, readGenericTargets } from '../../src/cli/syncAdapters/generic.js'
import { makeInstructionFileAdapter } from '../../src/cli/syncAdapters/instructionFileAdapter.js'
import {
  clearDaemonPid,
  daemonDisabled,
  daemonStatus,
  ensureDaemon,
  isPaused,
  pauseSync,
  readDaemonPid,
  resumeSync,
  writeDaemonPid,
} from '../../src/cli/daemon.js'

const context = { soul: '# SOUL.md\n\nsoul body\n', memory: '# MEMORY.md\n\nmemory body\n' }

test('injectManagedBlock is idempotent: an identical second write does not touch the file', async () => {
  await withHome(async home => {
    const file = path.join(home, 'AGENTS.md')
    const block = renderManagedBlock(context, 'guidance')
    await injectManagedBlock(file, block)
    const first = await fs.readFile(file, 'utf8')
    const mtimeBefore = (await fs.stat(file)).mtimeMs

    await injectManagedBlock(file, block)
    const second = await fs.readFile(file, 'utf8')
    const mtimeAfter = (await fs.stat(file)).mtimeMs

    assert.equal(second, first)
    assert.equal(mtimeAfter, mtimeBefore)
    assert.equal(first.match(/<!-- ethagent:start -->/g)?.length, 1)
  })
})

test('mergeClaudeHooks installs the three hooks once and is idempotent', async () => {
  await withHome(async home => {
    assert.equal(await mergeClaudeHooks(), true)
    assert.equal(await mergeClaudeHooks(), false)

    const settings = JSON.parse(await fs.readFile(path.join(home, '.claude', 'settings.json'), 'utf8'))
    const commands = JSON.stringify(settings)
    assert.equal((commands.match(/--session-start/g) ?? []).length, 1)
    assert.equal((commands.match(/--pretool-guard/g) ?? []).length, 1)
    assert.equal((commands.match(/--sync-on-edit/g) ?? []).length, 1)
  })
})

test('mergeClaudeHooks preserves existing settings and foreign hooks', async () => {
  await withHome(async home => {
    const claudeDir = path.join(home, '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'sonnet', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } }),
      'utf8',
    )

    assert.equal(await mergeClaudeHooks(), true)
    const settings = JSON.parse(await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8'))
    assert.equal(settings.model, 'sonnet')
    assert.equal(settings.hooks.SessionStart.length, 2)
    const text = JSON.stringify(settings)
    assert.match(text, /other-tool/)
    assert.match(text, /--session-start/)
  })
})

test('removeClaudeHooks strips ethagent hooks, keeps foreign hooks and keys, and is idempotent', async () => {
  await withHome(async home => {
    const claudeDir = path.join(home, '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'sonnet', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } }),
      'utf8',
    )
    await mergeClaudeHooks()

    assert.equal(await removeClaudeHooks(), true)
    assert.equal(await removeClaudeHooks(), false)

    const settings = JSON.parse(await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8'))
    const text = JSON.stringify(settings)
    assert.equal(settings.model, 'sonnet')
    assert.match(text, /other-tool/)
    assert.doesNotMatch(text, /ethagent/)
  })
})

test('removeClaudeHooks keeps a user hook that merely mentions ethagent (exact-match, not substring)', async () => {
  await withHome(async home => {
    const claudeDir = path.join(home, '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'npx ethagent save' }] }] } }),
      'utf8',
    )
    await mergeClaudeHooks()
    await removeClaudeHooks()

    const text = JSON.stringify(JSON.parse(await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8')))
    assert.match(text, /npx ethagent save/)
    assert.doesNotMatch(text, /--session-start/)
  })
})

test('claude bootstrap defers to the marketplace plugin when present and does not self-install', async () => {
  await withHome(async home => {
    await fs.mkdir(path.join(home, '.claude', 'plugins', 'ethagent'), { recursive: true })
    const actions = await claudeCodeAdapter.bootstrap()
    assert.match(actions.join(' '), /marketplace plugin detected/)
    const settingsExists = await fs.access(path.join(home, '.claude', 'settings.json')).then(() => true, () => false)
    assert.equal(settingsExists, false)
  })
})

test('claude bootstrap self-installs hooks when no plugin is present', async () => {
  await withHome(async home => {
    const actions = await claudeCodeAdapter.bootstrap()
    assert.match(actions.join(' '), /installed .*hooks/)
    const settingsExists = await fs.access(path.join(home, '.claude', 'settings.json')).then(() => true, () => false)
    assert.equal(settingsExists, true)
  })
})

test('generic adapter targets any instruction file from $ETHAGENT_HARNESS_FILES and round-trips', async () => {
  await withHome(async home => {
    const target = path.join(home, 'anywhere', 'CONTEXT.md')
    await withEnv('ETHAGENT_HARNESS_FILES', target, async () => {
      assert.deepEqual(await readGenericTargets(), [path.resolve(target)])
      assert.equal(await genericAdapter.detect(), true)

      await genericAdapter.mirror([], context)
      const parsed = parseManagedContext(await fs.readFile(target, 'utf8'))
      assert.equal(parsed.soul, 'soul body')
      assert.equal(parsed.memory, 'memory body')
    })
  })
})

test('generic adapter reads targets from ~/.ethagent/harnesses.json', async () => {
  await withHome(async home => {
    const target = path.join(home, 'tool', 'rules.md')
    const cfgDir = path.join(home, '.ethagent')
    await fs.mkdir(cfgDir, { recursive: true })
    await fs.writeFile(path.join(cfgDir, 'harnesses.json'), JSON.stringify([target]), 'utf8')

    assert.deepEqual(await readGenericTargets(), [path.resolve(target)])
    const actions = (await genericAdapter.bootstrap?.()) ?? []
    assert.equal(actions.length, 1)
    assert.match(await fs.readFile(target, 'utf8'), /ethagent portable identity is active/)
  })
})

test('generic adapter exposes one managed read per target (no collapse, so no cross-target edit loss)', async () => {
  await withHome(async home => {
    const a = path.join(home, 'a', 'AGENTS.md')
    const b = path.join(home, 'b', 'AGENTS.md')
    await withEnv('ETHAGENT_HARNESS_FILES', `${a},${b}`, async () => {
      await genericAdapter.mirror([], context)
      const candidates = (await genericAdapter.readManagedCandidates?.()) ?? []
      assert.equal(candidates.length, 2)
    })
  })
})

test('addGenericTarget registers a tool path and dedupes', async () => {
  await withHome(async home => {
    const target = path.join(home, 'newtool', 'RULES.md')
    const resolved = await addGenericTarget(target)
    assert.equal(resolved, path.resolve(target))
    assert.deepEqual(await readGenericTargets(), [path.resolve(target)])
    await addGenericTarget(target)
    assert.equal((await readGenericTargets()).length, 1)
  })
})

test('pause/resume toggles the persisted background-sync preference', async () => {
  await withHome(async () => {
    pauseSync()
    assert.equal(isPaused(), true)
    assert.equal(daemonDisabled(), true)
    assert.equal(ensureDaemon(), false)
    resumeSync()
    assert.equal(isPaused(), false)
    assert.equal(daemonDisabled(), false)
  })
})

test('instruction-file adapter mirrors soul/memory and bootstraps guidance', async () => {
  await withHome(async home => {
    const file = path.join(home, '.someharness', 'INSTRUCTIONS.md')
    const adapter = makeInstructionFileAdapter({
      name: 'someharness',
      description: 'test harness',
      filePath: () => file,
      detect: async () => true,
    })
    assert.equal(adapter.capabilities?.instructionFile, true)
    assert.equal(adapter.instructionFilePath?.(), file)

    await adapter.bootstrap?.()
    assert.match(await fs.readFile(file, 'utf8'), /ethagent portable identity is active/)

    await adapter.mirror([], context)
    const parsed = parseManagedContext(await fs.readFile(file, 'utf8'))
    assert.equal(parsed.soul, 'soul body')
    assert.equal(parsed.memory, 'memory body')
  })
})

test('daemon is disabled by ETHAGENT_NO_DAEMON and never spawns', async () => {
  await withEnv('ETHAGENT_NO_DAEMON', '1', async () => {
    assert.equal(daemonDisabled(), true)
    assert.equal(ensureDaemon(), false)
  })
})

test('daemon is single-instance: ensureDaemon is a no-op while a live pid file exists', async () => {
  await withHome(async () => {
    writeDaemonPid()
    assert.equal(readDaemonPid(), process.pid)
    const status = daemonStatus()
    assert.equal(status.running, true)
    assert.equal(status.pid, process.pid)
    assert.equal(ensureDaemon(), false)
    clearDaemonPid()
    assert.equal(daemonStatus().running, false)
  })
})

async function withEnv(key: string, value: string, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[key]
  process.env[key] = value
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-bootstrap-'))
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
