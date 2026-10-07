import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { injectManagedBlock, parseManagedContext, renderManagedBlock } from '../../src/cli/syncAdapters/managedBlock.js'
import { claudeCodeAdapter, mergeClaudeHooks, removeClaudeHooks } from '../../src/cli/syncAdapters/claude-code.js'
import { addGenericTarget, genericAdapter, readGenericTargets } from '../../src/cli/syncAdapters/generic.js'
import { makeInstructionFileAdapter } from '../../src/cli/syncAdapters/instructionFileAdapter.js'
import {
  claimDaemonPid,
  clearDaemonPid,
  daemonDisabled,
  daemonStatus,
  ensureDaemon,
  isPaused,
  isPidAlive,
  isWatcherCommandLine,
  pauseSync,
  readDaemonPid,
  readProcessCommandLine,
  releaseDaemonPid,
  resumeSync,
  writeDaemonPid,
  daemonPidPath,
  stopDaemon,
  touchDaemonPid,
  type CommandLineReader,
} from '../../src/cli/daemon.js'
import { withHome } from '../support/home.js'

const context = { soul: '# SOUL.md\n\nsoul body\n', memory: '# MEMORY.md\n\nmemory body\n' }
const watcherCommand: CommandLineReader = () => 'node --import tsx/esm /opt/ethagent/src/cli/main.tsx watch --daemon'
const otherCommand: CommandLineReader = () => 'node /srv/app/server.js'

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

test('a pid file that stopped beating is not a running daemon, and its pid is never signalled', async () => {
  await withHome(async () => {
    // The test runner's own pid stands in for a pid the system handed to another process.
    await writeQuietPid(process.pid)
    assert.equal(daemonStatus(otherCommand).running, false)
    assert.equal(readDaemonPid(), process.pid, 'reading the status changes nothing')
    assert.equal(stopDaemon(otherCommand), false, 'a quiet pid that is not a watcher is not ours to signal')
    await writeQuietPid(process.pid)
    assert.equal(touchDaemonPid(), true)
    assert.equal(daemonStatus(otherCommand).running, true, 'a heartbeat makes it current again')
    clearDaemonPid()
  })
})

test('a watcher that never beats is still the daemon, and stopDaemon stops it', async () => {
  await withHome(async () => {
    await withStandIn(async (pid, exited) => {
      // A watcher from before the heartbeat: alive, quiet, and a watcher by its command line.
      await writeQuietPid(pid)
      assert.deepEqual(daemonStatus(watcherCommand), { running: true, pid })
      assert.equal(stopDaemon(watcherCommand), true)
      await exited
      assert.equal(readDaemonPid(), null)
    })
  })
})

test('a starting watcher takes over a quiet one, once that one is gone', async () => {
  await withHome(async () => {
    await withStandIn(async pid => {
      await writeQuietPid(pid)
      assert.equal(await claimDaemonPid(watcherCommand), true)
      assert.equal(isPidAlive(pid), false, 'the old watcher was stopped before the file was taken')
      assert.equal(readDaemonPid(), process.pid)
      clearDaemonPid()
    })
  })
})

test('a starting watcher claims over a quiet pid that is not a watcher, without signalling it', async () => {
  await withHome(async () => {
    await withStandIn(async pid => {
      await writeQuietPid(pid)
      assert.equal(await claimDaemonPid(otherCommand), true)
      assert.equal(readDaemonPid(), process.pid)
      assert.equal(isPidAlive(pid), true, 'the other process is left alone')
      clearDaemonPid()
    })
  })
})

test('a starting watcher leaves a beating one in place', async () => {
  await withHome(async () => {
    await withStandIn(async pid => {
      await writePid(pid)
      assert.equal(await claimDaemonPid(watcherCommand), false)
      assert.equal(readDaemonPid(), pid)
      assert.equal(isPidAlive(pid), true)
      assert.equal(ensureDaemon(), false)
    })
  })
})

test('the heartbeat tells a watcher to stop when sync is paused or another watcher took over', async () => {
  await withHome(async () => {
    writeDaemonPid()
    assert.equal(touchDaemonPid(), true)
    clearDaemonPid()
    assert.equal(touchDaemonPid(), true, 'a removed file is taken back')
    assert.equal(readDaemonPid(), process.pid)

    clearDaemonPid()
    pauseSync()
    writeDaemonPid()
    assert.equal(touchDaemonPid(), false, 'paused while running')
    resumeSync()

    await withStandIn(async pid => {
      await writePid(pid)
      assert.equal(touchDaemonPid(), false, 'another live process holds the file')
      releaseDaemonPid()
      assert.equal(readDaemonPid(), pid, "a successor's file is left in place")
    })
    writeDaemonPid()
    releaseDaemonPid()
    assert.equal(readDaemonPid(), null)
  })
})

test('isWatcherCommandLine recognizes a watcher of any version on every platform', () => {
  for (const line of [
    'node --import file:///home/a/.npm/_npx/1f/node_modules/tsx/dist/esm/index.mjs /home/a/.npm/_npx/1f/node_modules/ethagent/src/cli/main.tsx watch --daemon',
    'node --import file:///C:/Users/a/dev/ethagent/node_modules/tsx/dist/esm/index.mjs C:\\Users\\a\\dev\\ethagent\\src\\cli\\main.tsx watch --daemon',
    '"C:\\Program Files\\nodejs\\node.exe" --import file:///C:/x/tsx/dist/esm/index.mjs "C:\\Users\\a b\\ethagent\\src\\cli\\main.tsx" watch --daemon',
    'node --import tsx/esm /opt/ethagent/src/cli/main.tsx watch',
  ]) {
    assert.equal(isWatcherCommandLine(line), true, line)
  }
  for (const line of [
    null,
    '',
    'node /srv/app/server.js',
    'node --import tsx/esm /opt/ethagent/src/cli/main.tsx',
    'node --import tsx/esm /opt/ethagent/src/cli/main.tsx status --json',
    'node /opt/other/watch --daemon',
  ]) {
    assert.equal(isWatcherCommandLine(line), false, String(line))
  }
})

test('readProcessCommandLine reads how a live process was started', () => {
  const line = readProcessCommandLine(process.pid)
  assert.ok(line?.includes('run.js'), `got: ${line}`)
  assert.equal(isWatcherCommandLine(line), false)
})

async function writePid(pid: number): Promise<void> {
  await fs.mkdir(path.dirname(daemonPidPath()), { recursive: true })
  await fs.writeFile(daemonPidPath(), `${pid}\n`, 'utf8')
}

// A pid file whose last beat was ten minutes ago.
async function writeQuietPid(pid: number): Promise<void> {
  await writePid(pid)
  const old = new Date(Date.now() - 10 * 60_000)
  await fs.utimes(daemonPidPath(), old, old)
}

// A live process for a pid file to point at. It is killed when the test is done with it.
async function withStandIn(fn: (pid: number, exited: Promise<void>) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()) })
  await once(child, 'spawn')
  try {
    await fn(child.pid!, exited)
  } finally {
    child.kill()
    await exited
  }
}

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

