import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir, saveConfig, type EthagentIdentity } from '../../src/storage/config.js'
import { detectSyncTargets, runSync } from '../../src/cli/sync.js'
import { BOOTSTRAP_VERSION, isStateFresh, runBootstrap, type BootstrapSeams } from '../../src/cli/bootstrap.js'
import { readSyncHealth } from '../../src/cli/syncHealth.js'
import type { SyncAdapter } from '../../src/cli/syncAdapters/index.js'
import { genericAdapter } from '../../src/cli/syncAdapters/generic.js'
import { runStatus } from '../../src/cli/status.js'
import { withHome } from '../support/home.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  createdAt: '2026-01-01T00:00:00.000Z',
  chainId: 8453,
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
  agentId: '42',
}

function adapter(overrides: Partial<SyncAdapter> = {}): SyncAdapter {
  return {
    name: 'fixture', description: 'fixture', detect: async () => true,
    mirror: async () => ({ count: 1, skipped: 0, issues: [] }),
    ...overrides,
  }
}

test('sync records mirror failures as incomplete, then clears them after a full mirror', async () => {
  await withHome(async () => {
    await saveConfig({ version: 2, firstSeenAt: identity.createdAt, identity })
    const failed = adapter({ mirror: async () => ({
      count: 0, skipped: 0,
      issues: [{ kind: 'mirror', root: 'C:/fixture/skills', skill: 'demo', detail: 'EBUSY: resource busy or locked' }],
    }) })
    assert.equal(await runSync({ quiet: true, adapters: [failed] }), 1)
    const first = await readSyncHealth(identity)
    assert.equal(first?.state, 'failed')
    assert.equal(first?.lastSuccessAt, null)
    assert.deepEqual(first?.issues.map(issue => [issue.kind, issue.skill]), [['mirror', 'demo']])

    assert.equal(await runSync({ quiet: true, adapters: [adapter()] }), 0)
    const recovered = await readSyncHealth(identity)
    assert.equal(recovered?.state, 'ok')
    assert.deepEqual(recovered?.issues, [])
    assert.equal(recovered?.lastSuccessAt, recovered?.attemptedAt)
    assert.equal((await readSyncHealth({ ...identity, address: '0x0000000000000000000000000000000000000002' }))?.state, 'ok')

    assert.equal(await runSync({ quiet: true, adapters: [failed] }), 1)
    assert.equal((await readSyncHealth(identity))?.lastSuccessAt, recovered?.lastSuccessAt)
    assert.equal(await readSyncHealth({ ...identity, agentId: '43' }), null)
  })
})

test('a skill collision is recorded without failing sync or holding back the bootstrap stamp', async () => {
  await withHome(async () => {
    await saveConfig({ version: 2, firstSeenAt: identity.createdAt, identity })
    const colliding = adapter({ mirror: async () => ({
      count: 0, skipped: 1,
      issues: [{ kind: 'skipped', root: 'C:/fixture/skills', skill: 'demo', detail: 'an unmanaged folder has this name; move or delete it' }],
    }) })
    assert.equal(await runSync({ quiet: true, adapters: [colliding] }), 0)
    const health = await readSyncHealth(identity)
    assert.equal(health?.state, 'ok')
    assert.equal(health?.lastSuccessAt, health?.attemptedAt)
    assert.deepEqual(health?.issues.map(issue => [issue.kind, issue.skill]), [['skipped', 'demo']])

    const seams: BootstrapSeams = {
      loadConfig: async () => ({ version: 2, firstSeenAt: identity.createdAt, identity }),
      detectTargets: async () => [colliding],
      sync: () => runSync({ quiet: true, adapters: [colliding] }),
      daemonDisabled: () => false,
      ensureDaemon: () => true,
      waitForDaemon: async () => ({ running: true, pid: 123 }),
      installAutostart: () => ({ installed: true, detail: 'shell hook' }),
    }
    assert.equal(await runBootstrap({ quiet: true, seams }), 0)
    assert.equal(isStateFresh(), true)
  })
})

test('sync continues healthy targets when another target detection or mirror fails', async () => {
  await withHome(async () => {
    await saveConfig({ version: 2, firstSeenAt: identity.createdAt, identity })
    let mirrored = 0
    const good = adapter({ mirror: async () => { mirrored++; return { count: 0, skipped: 0, issues: [] } } })
    const bad = adapter({ name: 'broken', detect: async () => { throw new Error('access denied') } })
    assert.equal(await runSync({ quiet: true, adapters: [bad, good] }), 1)
    assert.equal(mirrored, 1)
    assert.deepEqual((await readSyncHealth(identity))?.issues.map(issue => issue.kind), ['detect'])

    const throwing = adapter({ name: 'throwing', mirror: async () => { throw new Error('file busy') } })
    assert.equal(await runSync({ quiet: true, adapters: [throwing, good] }), 1)
    assert.equal(mirrored, 2)
    assert.deepEqual((await readSyncHealth(identity))?.issues.map(issue => issue.kind), ['adapter'])
  })
})

test('sync records a failed harness read before any mirror writes', async () => {
  await withHome(async () => {
    await saveConfig({ version: 2, firstSeenAt: identity.createdAt, identity })
    let mirrored = false
    const unreadable = adapter({
      readManaged: async () => { throw new Error('instruction file is locked') },
      mirror: async () => { mirrored = true; return { count: 0, skipped: 0, issues: [] } },
    })
    assert.equal(await runSync({ quiet: true, adapters: [unreadable] }), 1)
    assert.equal(mirrored, false)
    assert.equal((await readSyncHealth(identity))?.issues[0]?.kind, 'reconcile')
  })
})

test('malformed generic target configuration fails sync instead of reading as no harness', async () => {
  await withHome(async () => {
    await saveConfig({ version: 2, firstSeenAt: identity.createdAt, identity })
    await fs.writeFile(path.join(getConfigDir(), 'harnesses.json'), '{bad json')
    assert.equal(await runSync({ quiet: true, adapters: [genericAdapter] }), 1)
    const health = await readSyncHealth(identity)
    assert.equal(health?.state, 'failed')
    assert.equal(health?.issues[0]?.kind, 'detect')
    assert.match(health?.issues[0]?.detail ?? '', /invalid JSON/)
    const out: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => { out.push(String(chunk)); return true }) as typeof process.stdout.write
    try { assert.equal(await runStatus('6.1.0'), 1) } finally { process.stdout.write = original }
    assert.match(out.join(''), /harness detection failed: generic: .*invalid JSON/)
  })
})

test('bootstrap replaces old stamps only after adapters, sync, daemon, and autostart succeed', async () => {
  await withHome(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    const stamp = path.join(getConfigDir(), 'bootstrap-state.json')
    await fs.writeFile(stamp, '{"version":1}\n')
    assert.equal(isStateFresh(), false)
    let syncCode = 1
    let daemonRunning = true
    let autostartInstalled = true
    let bootstrapFails = false
    const target = adapter({ bootstrap: async () => {
      if (bootstrapFails) throw new Error('hook locked')
      return []
    } })
    const seams: BootstrapSeams = {
      loadConfig: async () => ({ version: 2, firstSeenAt: identity.createdAt, identity }),
      detectTargets: async () => [target],
      sync: async () => syncCode,
      daemonDisabled: () => false,
      ensureDaemon: () => true,
      waitForDaemon: async () => ({ running: daemonRunning, pid: daemonRunning ? 123 : null }),
      installAutostart: () => ({ installed: autostartInstalled, detail: 'no writable shell profile' }),
    }
    const version = async () => JSON.parse(await fs.readFile(stamp, 'utf8')).version as number
    assert.equal(await runBootstrap({ quiet: true, seams }), 1)
    assert.equal(await version(), 1)
    syncCode = 0
    daemonRunning = false
    assert.equal(await runBootstrap({ quiet: true, seams }), 1)
    assert.equal(await version(), 1)
    daemonRunning = true
    autostartInstalled = false
    assert.equal(await runBootstrap({ quiet: true, seams }), 1)
    assert.equal(await version(), 1)
    autostartInstalled = true
    bootstrapFails = true
    assert.equal(await runBootstrap({ quiet: true, seams }), 1)
    assert.equal(await version(), 1)
    bootstrapFails = false
    assert.equal(await runBootstrap({ quiet: true, seams }), 0)
    assert.equal(await version(), BOOTSTRAP_VERSION)
    assert.equal(isStateFresh(), true)
  })
})

test('bootstrap wires the harnesses it can detect when another fails detection, without stamping', async () => {
  await withHome(async () => {
    let wired = 0
    const healthy = adapter({ bootstrap: async () => { wired++; return [] } })
    const broken = adapter({ name: 'broken', detect: async () => { throw new Error('access denied') } })
    const seams: BootstrapSeams = {
      loadConfig: async () => ({ version: 2, firstSeenAt: identity.createdAt, identity }),
      detectTargets: onError => detectSyncTargets([broken, healthy], onError),
      sync: async () => 0,
      daemonDisabled: () => false,
      ensureDaemon: () => true,
      waitForDaemon: async () => ({ running: true, pid: 123 }),
      installAutostart: () => ({ installed: true, detail: 'shell hook' }),
    }
    assert.equal(await runBootstrap({ quiet: true, seams }), 1)
    assert.equal(wired, 1)
    assert.equal(isStateFresh(), false)
  })
})

test('paused bootstrap can finish without starting a daemon', async () => {
  await withHome(async () => {
    const seams: BootstrapSeams = {
      loadConfig: async () => ({ version: 2, firstSeenAt: identity.createdAt, identity }),
      detectTargets: async () => [],
      sync: async () => 0,
      daemonDisabled: () => true,
      ensureDaemon: () => { throw new Error('should not start') },
      waitForDaemon: async () => { throw new Error('should not wait') },
      installAutostart: () => { throw new Error('should not install') },
    }
    assert.equal(await runBootstrap({ quiet: true, seams }), 0)
    const stamp = JSON.parse(await fs.readFile(path.join(getConfigDir(), 'bootstrap-state.json'), 'utf8'))
    assert.equal(stamp.version, BOOTSTRAP_VERSION)
    assert.equal(stamp.daemonConfigured, false)
    assert.equal(isStateFresh(), false)
  })
})

test('status shows the last sync failure separately from watcher liveness', async () => {
  await withHome(async () => {
    await saveConfig({ version: 2, firstSeenAt: identity.createdAt, identity })
    const failed = adapter({ mirror: async () => ({
      count: 0, skipped: 0,
      issues: [{ kind: 'mirror', root: 'fixture/skills', skill: 'demo', detail: 'EBUSY: resource busy or locked' }],
    }) })
    await runSync({ quiet: true, adapters: [failed] })
    const out: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => { out.push(String(chunk)); return true }) as typeof process.stdout.write
    try { assert.equal(await runStatus('6.1.0'), 0) } finally { process.stdout.write = original }
    const text = out.join('')
    assert.match(text, /background sync:/)
    assert.match(text, /last sync: incomplete/)
    assert.match(text, /fixture\/skills\/demo: EBUSY/)
  })
})
