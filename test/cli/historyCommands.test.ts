import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runHistoryCommand } from '../../src/cli/history/index.js'
import { runRollbackCommand } from '../../src/cli/history/rollback.js'
import { generatePrivateKey } from '../../src/identity/crypto/eth.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import { putSnapshot } from '../../src/identity/continuity/snapshotStore.js'
import { readPackedWorkingView } from '../../src/identity/continuity/storage/packed.js'
import { continuitySnapshotContentHashesFromSources } from '../../src/identity/continuity/storage/status.js'
import { continuityVaultRef } from '../../src/identity/continuity/storage/paths.js'
import type { PublishedContinuitySnapshot } from '../../src/identity/continuity/snapshots.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import { captureIo, withHome, type CapturedIo } from '../support/home.js'

const CID_1 = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'
const CID_2 = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'

function makeIdentity(): EthagentIdentity {
  return {
    source: 'erc8004',
    address: '0x000000000000000000000000000000000000dEaD',
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    createdAt: '2026-01-01T00:00:00.000Z',
    chainId: 1,
    identityRegistryAddress: '0x0000000000000000000000000000000000000001',
    agentId: '42',
    state: { name: 'test agent', description: 'public test agent' },
    backup: { cid: CID_2, createdAt: '2026-02-01T00:00:00.000Z', envelopeVersion: '1', ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files', status: 'pinned' },
  } as EthagentIdentity
}

const MEMORY_V1 = '# MEMORY.md\n\n## Rules\n- Git approval: ask first.\n- Tone: calm.\n'
const MEMORY_V2 = '# MEMORY.md\n\n## Rules\n- Git approval: ask first, every time.\n- Tone: calm.\n- Café: new rule.\n'

type Setup = {
  identity: EthagentIdentity
  ledger: PublishedContinuitySnapshot[]
  makeDeps: (env?: NodeJS.ProcessEnv) => HistoryDeps & { io: CapturedIo }
  run: (verb: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<{ code: number; io: CapturedIo }>
}

async function setup(): Promise<Setup> {
  const identity = makeIdentity()
  const ref = continuityVaultRef(identity)
  await fs.mkdir(path.join(ref.skillsDir, 'alpha'), { recursive: true })
  await fs.writeFile(ref.soulPath, '# SOUL.md\n- Voice: calm\n')
  await fs.writeFile(ref.memoryPath, MEMORY_V1)
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: alpha skill\nvisibility: private\n---\nbody\n')
  const ledger: PublishedContinuitySnapshot[] = []
  const record = async (cid: string, createdAt: string): Promise<void> => {
    const view = await readPackedWorkingView(identity)
    await putSnapshot(identity, cid, view.sources, { source: 'save', createdAt })
    ledger.unshift({
      version: 1,
      id: `${createdAt}:${cid}`,
      createdAt,
      cid,
      label: 'published encrypted snapshot',
      contentHashes: continuitySnapshotContentHashesFromSources(view.sources),
      identity: { address: identity.address },
    })
  }
  await record(CID_1, '2026-01-15T00:00:00.000Z')
  await fs.writeFile(ref.memoryPath, MEMORY_V2)
  await record(CID_2, '2026-02-01T00:00:00.000Z')
  const config = { version: 2, firstSeenAt: identity.createdAt, identity } as EthagentConfig
  const makeDeps = (env: NodeJS.ProcessEnv = {}): HistoryDeps & { io: CapturedIo } => ({
    io: captureIo(),
    env: { ...env },
    now: () => new Date('2026-03-01T00:00:00.000Z'),
    loadConfig: async () => config,
    listLedger: async () => ledger.slice(),
  })
  const run = async (verb: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; io: CapturedIo }> => {
    const deps = makeDeps(env)
    return { code: await runHistoryCommand(verb, args, deps), io: deps.io }
  }
  return { identity, ledger, makeDeps, run }
}

test('status reports exact per-file changes against the cached latest snapshot', async () => {
  await withHome(async () => {
    const { identity, run } = await setup()
    const clean = await run('status', ['--json'])
    assert.equal(clean.code, 0)
    assert.equal(clean.io.json().publishState, 'published')
    assert.deepEqual(clean.io.json().changes, [])
    await fs.writeFile(continuityVaultRef(identity).memoryPath, MEMORY_V2.replace(/\n/g, '\r\n'))
    const eol = await run('status', ['--json'])
    const changes = eol.io.json().changes as Array<Record<string, unknown>>
    assert.equal(changes[0]!.path, 'MEMORY.md')
    assert.equal(changes[0]!.eolOnly, true)
    assert.equal((eol.io.json().baseline as Record<string, unknown>).exact, true)
    assert.doesNotMatch(eol.io.stdout(), /[\u0080-￿]/)
  })
})

test('history lists snapshots newest first and --file keeps only those that changed it', async () => {
  await withHome(async () => {
    const { run } = await setup()
    const all = await run('history', ['--json', '--stat'])
    const entries = all.io.json().entries as Array<Record<string, unknown>>
    assert.deepEqual(entries.map(entry => entry.ref), ['latest', 'latest~1'])
    assert.equal(entries[0]!.cache, 'cached')
    assert.deepEqual((entries[0]!.changes as Array<Record<string, unknown>>).map(change => change.path), ['MEMORY.md'])
    const soul = await run('history', ['--json', '--file', 'SOUL.md'])
    assert.deepEqual((soul.io.json().entries as Array<Record<string, unknown>>).map(entry => entry.ref), ['latest~1'])
    const sections = await run('history', ['--sections'])
    assert.match(sections.io.stdout(), /Git approval/)
  })
})

test('diff returns byte, line, and section layers between two snapshots', async () => {
  await withHome(async () => {
    const { run } = await setup()
    const { code, io } = await run('diff', ['latest~1', 'latest', '--json'])
    assert.equal(code, 0)
    const result = io.json()
    assert.equal(result.identical, false)
    const files = result.files as Array<Record<string, unknown>>
    assert.equal(files.length, 1)
    const memory = files[0]!
    assert.equal(memory.path, 'MEMORY.md')
    assert.equal(memory.added, 2)
    assert.equal(memory.removed, 1)
    const sections = memory.sections as Array<Record<string, unknown>>
    assert.deepEqual((sections[0]!.modified as Array<Record<string, unknown>>).map(item => item.label), ['Git approval'])
    const text = await run('diff', ['latest~1', 'latest'])
    assert.match(text.io.stdout(), /@@ .* @@ ## Rules/)
    const same = await run('diff', ['--json'])
    assert.equal(same.io.json().identical, true)
  })
})

test('show prints exact bytes and refs fail with clear codes', async () => {
  await withHome(async () => {
    const { ledger, run } = await setup()
    const shown = await run('show', ['latest~1', '--file', 'MEMORY.md'])
    assert.equal(shown.io.stdoutBytes().toString('utf8'), MEMORY_V1)
    const ambiguous = await run('show', ['bafkreiaaaa', '--json'])
    assert.equal(ambiguous.code, 2)
    assert.match(String(ambiguous.io.json().hint), /candidates/)
    ledger.unshift({ ...ledger[0]!, cid: 'bafkreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3', createdAt: '2026-02-10T00:00:00.000Z' })
    const uncached = await run('show', ['latest', '--json'])
    assert.equal(uncached.code, 3)
    assert.match(String(uncached.io.json().hint), /ethagent fetch/)
    const unknown = await run('show', ['nope-not-a-ref', '--json'])
    assert.equal(unknown.code, 1)
  })
})

test('rollback previews by default, applies exact bytes with --yes, and --undo reverses it', async () => {
  await withHome(async () => {
    const { identity, run } = await setup()
    const memoryPath = continuityVaultRef(identity).memoryPath
    const preview = await run('rollback', ['latest~1', '--json'])
    assert.equal(preview.io.json().applied, false)
    assert.equal(await fs.readFile(memoryPath, 'utf8'), MEMORY_V2)
    const applied = await run('rollback', ['latest~1', '--yes', '--json'])
    assert.equal(applied.code, 0)
    assert.equal(applied.io.json().applied, true)
    assert.equal(await fs.readFile(memoryPath, 'utf8'), MEMORY_V1)
    const undo = await run('rollback', ['--undo', '--yes', '--json'])
    assert.equal(undo.code, 0)
    assert.equal(await fs.readFile(memoryPath, 'utf8'), MEMORY_V2)
    const card = await run('rollback', ['latest~1', '--file', 'agent-card.json', '--json'])
    assert.equal(card.code, 2)
  })
})

test('rollback leaves skills alone when the target carries none', async () => {
  await withHome(async () => {
    const { identity, ledger, run } = await setup()
    const skillPath = path.join(continuityVaultRef(identity).skillsDir, 'alpha', 'SKILL.md')
    const bare = 'bafkreicccccccccccccccccccccccccccccccccccccccccccccccccccc4'
    await putSnapshot(identity, bare, { privateFiles: { 'SOUL.md': 'old soul\n', 'MEMORY.md': 'old memory\n' } }, { source: 'save', createdAt: '2025-12-01T00:00:00.000Z' })
    ledger.push({ ...ledger[0]!, cid: bare, createdAt: '2025-12-01T00:00:00.000Z' })
    const result = await run('rollback', [bare, '--yes', '--json'])
    assert.equal(result.code, 0)
    assert.ok(await fs.readFile(skillPath, 'utf8'))
    assert.equal(await fs.readFile(continuityVaultRef(identity).memoryPath, 'utf8'), 'old memory\n')
  })
})

test('checkpoint and forget manage local history with previews', async () => {
  await withHome(async () => {
    const { run } = await setup()
    const checkpoint = await run('checkpoint', ['before', 'edits', '--json'])
    assert.equal(checkpoint.code, 0)
    const ref = String(checkpoint.io.json().ref)
    assert.match(ref, /^cp:cp-/)
    const listed = await run('history', ['--json'])
    assert.ok((listed.io.json().entries as Array<Record<string, unknown>>).some(entry => entry.ref === ref))
    const preview = await run('forget', ['latest~1', '--file', 'MEMORY.md', '--json'])
    assert.equal(preview.io.json().applied, false)
    const applied = await run('forget', ['latest~1', '--file', 'MEMORY.md', '--yes', '--json'])
    assert.equal(applied.io.json().applied, true)
    const gone = await run('show', ['latest~1', '--file', 'MEMORY.md', '--json'])
    assert.equal(gone.code, 1)
  })
})

test('fetch without a key exits 3 with a hint', async () => {
  await withHome(async () => {
    const { run } = await setup()
    const result = await run('fetch', ['--all', '--json'])
    assert.equal(result.code, 3)
    assert.match(String(result.io.json().hint), /ETHAGENT_OPERATOR_KEY/)
    const invalid = await run('fetch', ['--all', '--json'], { ETHAGENT_OPERATOR_KEY: 'nope' })
    assert.equal(invalid.code, 2)
  })
})

test('rollback never writes build caches back from an old snapshot', async () => {
  await withHome(async () => {
    const { identity, ledger, run } = await setup()
    const ref = continuityVaultRef(identity)
    const old = 'bafkreidddddddddddddddddddddddddddddddddddddddddddddddddddd5'
    await putSnapshot(identity, old, {
      privateFiles: { 'SOUL.md': 'old soul\n', 'MEMORY.md': 'old memory\n' },
      skills: { 'alpha/SKILL.md': 'old alpha\n', 'alpha/__pycache__/a.cpython-312.pyc': 'junk', 'alpha/node_modules/x/index.js': 'junk' },
    }, { source: 'fetch', createdAt: '2025-11-01T00:00:00.000Z' })
    ledger.push({ ...ledger[0]!, cid: old, createdAt: '2025-11-01T00:00:00.000Z' })
    const result = await run('rollback', [old, '--yes', '--json'])
    assert.equal(result.code, 0)
    assert.equal(await fs.readFile(path.join(ref.skillsDir, 'alpha', 'SKILL.md'), 'utf8'), 'old alpha\n')
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'alpha', '__pycache__')))
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'alpha', 'node_modules')))
  })
})

test('rollback pulls tool edits before planning, so they land in the undo checkpoint', async () => {
  await withHome(async () => {
    const { identity, makeDeps } = await setup()
    const memoryPath = continuityVaultRef(identity).memoryPath
    await fs.writeFile(memoryPath, MEMORY_V1)
    const pull = async (): Promise<string[]> => {
      await fs.writeFile(memoryPath, 'edit pulled from a tool\n')
      return ['MEMORY.md']
    }
    const push = async (): Promise<void> => {}
    const applied = makeDeps()
    assert.equal(await runRollbackCommand(['latest~1', '--yes', '--json'], applied, { pull, push }), 0)
    assert.equal(applied.io.json().applied, true)
    assert.equal(await fs.readFile(memoryPath, 'utf8'), MEMORY_V1)
    const undone = makeDeps()
    assert.equal(await runRollbackCommand(['--undo', '--yes', '--json'], undone, { pull: async () => [], push }), 0)
    assert.equal(await fs.readFile(memoryPath, 'utf8'), 'edit pulled from a tool\n')
  })
})

test('undo removes a skill that the rollback created', async () => {
  await withHome(async () => {
    const { identity, ledger, run } = await setup()
    const ref = continuityVaultRef(identity)
    const view = await readPackedWorkingView(identity)
    const withBeta = 'bafkreieeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee6'
    await putSnapshot(identity, withBeta, {
      ...view.sources,
      skills: { ...view.sources.skills, 'beta/SKILL.md': '---\nvisibility: private\n---\nbeta\n' },
    }, { source: 'fetch', createdAt: '2025-10-01T00:00:00.000Z' })
    ledger.push({ ...ledger[0]!, cid: withBeta, createdAt: '2025-10-01T00:00:00.000Z' })
    const betaPath = path.join(ref.skillsDir, 'beta', 'SKILL.md')
    assert.equal((await run('rollback', [withBeta, '--yes', '--json'])).code, 0)
    assert.ok(await fs.readFile(betaPath, 'utf8'))
    const undo = await run('rollback', ['--undo', '--yes', '--json'])
    assert.equal(undo.io.json().applied, true)
    await assert.rejects(fs.access(betaPath))
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'beta')))
  })
})

test('fetch --all skips forgotten snapshots without failing', async () => {
  await withHome(async () => {
    const { run } = await setup()
    assert.equal((await run('forget', ['latest~1', '--yes', '--json'])).code, 0)
    const result = await run('fetch', ['--all', '--json'], { ETHAGENT_OPERATOR_KEY: generatePrivateKey() })
    assert.equal(result.code, 0)
    const totals = result.io.json().totals as Record<string, number>
    assert.equal(totals.skipped, 1)
    assert.equal(totals.alreadyCached, 1)
  })
})

test('history commands clear the operator key from their environment', async () => {
  await withHome(async () => {
    const { makeDeps } = await setup()
    const deps = makeDeps({ ETHAGENT_OPERATOR_KEY: generatePrivateKey(), KEEP: '1' })
    assert.equal(await runHistoryCommand('status', ['--json'], deps), 0)
    assert.deepEqual(deps.env, { KEEP: '1' })
  })
})

test('show reports a forgotten file however its path is spelled', async () => {
  await withHome(async () => {
    const { run } = await setup()
    assert.equal((await run('forget', ['latest~1', '--file', 'MEMORY.md', '--yes', '--json'])).code, 0)
    const result = await run('show', ['latest~1', '--file', '.\\memory.md', '--json'])
    assert.equal(result.code, 1)
    assert.match(String(result.io.json().error), /forgotten/)
  })
})
