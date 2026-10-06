import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  forgetContent,
  forgetSnapshot,
  listCheckpoints,
  putCheckpoint,
  putSnapshot,
  readEntryBytes,
  readObject,
  readSnapshotManifest,
  snapshotStoreDir,
  StoreBusyError,
  StoreCorruptError,
  withStoreLock,
} from '../../../src/identity/continuity/snapshotStore.js'
import { packedFileMap, readPackedWorkingView } from '../../../src/identity/continuity/storage/packed.js'
import { checkpointBeforeRestore } from '../../../src/identity/continuity/snapshotCapture.js'
import { markCurrentContinuityFilesPublished } from '../../../src/identity/manager/shared/effects/sync.js'
import { loadSkillsTree } from '../../../src/identity/continuity/skills/loadSkills.js'
import { syncAgentCardManifest } from '../../../src/identity/continuity/skills/publicSkillsSync.js'
import { readContinuityFiles } from '../../../src/identity/continuity/storage/files.js'
import { continuityVaultRef } from '../../../src/identity/continuity/storage/paths.js'
import { localContinuitySnapshotContentHashes, continuitySnapshotContentHashesFromSources } from '../../../src/identity/continuity/storage/status.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'
import { withHome } from '../../support/home.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  chainId: 1,
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
  agentId: '42',
  state: { name: 'test agent', description: 'public test agent' },
}

const tricky = {
  'SOUL.md': '﻿# SOUL.md\r\n- Voice: calm\r\nno trailing newline',
  'MEMORY.md': '# MEMORY.md\n- Emoji: \u{1F408} cat\n',
}

test('snapshot store round-trips exact bytes and dedups identical content across cids', async () => {
  await withHome(async () => {
    const first = await putSnapshot(identity, 'bafyfirst', { privateFiles: tricky, skills: { 'a/SKILL.md': 'skill a\n' } }, { source: 'save' })
    const second = await putSnapshot(identity, 'bafysecond', { privateFiles: { ...tricky, 'MEMORY.md': 'changed\n' }, skills: { 'a/SKILL.md': 'skill a\n' } }, { source: 'save' })
    const read = await readEntryBytes(identity, first.files)
    assert.equal(Buffer.from(read.files['SOUL.md']!).toString('utf8'), tricky['SOUL.md'])
    assert.equal(Buffer.from(read.files['MEMORY.md']!).toString('utf8'), tricky['MEMORY.md'])
    assert.equal(first.files['skills/a/SKILL.md']!.sha256, second.files['skills/a/SKILL.md']!.sha256)
    const objects = await fs.readdir(path.join(snapshotStoreDir(identity), 'objects'))
    assert.equal(objects.length, 4)
  })
})

test('snapshot manifests for CIDs that differ only by case stay separate', async () => {
  await withHome(async () => {
    await putSnapshot(identity, 'QmAbc', { privateFiles: tricky }, { source: 'save' })
    await putSnapshot(identity, 'Qmabc', { privateFiles: { ...tricky, 'MEMORY.md': 'other\n' } }, { source: 'save' })
    const a = await readSnapshotManifest(identity, 'QmAbc')
    const b = await readSnapshotManifest(identity, 'Qmabc')
    assert.equal(a?.kind, 'snapshot')
    assert.equal(b?.kind, 'snapshot')
    assert.notEqual(a?.kind === 'snapshot' && a.files['MEMORY.md']!.sha256, b?.kind === 'snapshot' && b.files['MEMORY.md']!.sha256)
  })
})

test('a tampered object fails its hash check', async () => {
  await withHome(async () => {
    const manifest = await putSnapshot(identity, 'bafyx', { privateFiles: tricky }, { source: 'save' })
    const sha = manifest.files['MEMORY.md']!.sha256
    await fs.writeFile(path.join(snapshotStoreDir(identity), 'objects', sha), 'tampered')
    await assert.rejects(() => readObject(identity, sha), StoreCorruptError)
  })
})

test('forgotten content is erased everywhere and never cached again', async () => {
  await withHome(async () => {
    const leaked = { ...tricky, 'MEMORY.md': 'password: hunter2\n' }
    const first = await putSnapshot(identity, 'bafyone', { privateFiles: leaked }, { source: 'save' })
    const sha = first.files['MEMORY.md']!.sha256
    await putCheckpoint(identity, { reason: 'manual', scope: 'vault', files: { 'MEMORY.md': Buffer.from(leaked['MEMORY.md']) } })
    const removed = await forgetContent(identity, [sha])
    assert.equal(removed.objects, 1)
    assert.equal(removed.manifests, 1)
    assert.equal(removed.checkpoints, 1)
    assert.equal(await readObject(identity, sha), null)
    const again = await putSnapshot(identity, 'bafytwo', { privateFiles: leaked }, { source: 'fetch' })
    assert.equal(again.files['MEMORY.md']!.forgotten, true)
    assert.equal(await readObject(identity, sha), null)
    const [checkpoint] = await listCheckpoints(identity)
    assert.equal(checkpoint!.files['MEMORY.md']!.forgotten, true)
  })
})

test('forgetting a snapshot keeps content other entries still use', async () => {
  await withHome(async () => {
    const a = await putSnapshot(identity, 'bafya', { privateFiles: tricky }, { source: 'save' })
    await putSnapshot(identity, 'bafyb', { privateFiles: { ...tricky, 'MEMORY.md': 'unique to b\n' } }, { source: 'save' })
    const result = await forgetSnapshot(identity, 'bafyb')
    assert.equal(result.objects, 1)
    assert.equal(await readSnapshotManifest(identity, 'bafyb'), null)
    assert.ok(await readObject(identity, a.files['SOUL.md']!.sha256))
  })
})

test('store lock reclaims a dead holder and reports a live one as busy', async () => {
  await withHome(async () => {
    const lock = path.join(snapshotStoreDir(identity), 'lock')
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, '999999\n')
    assert.equal(await withStoreLock(identity, async () => 'ran'), 'ran')
    await fs.writeFile(lock, `${process.ppid}\n`)
    await assert.rejects(() => withStoreLock(identity, async () => 'ran'), StoreBusyError)
    await fs.writeFile(lock, `${process.pid}\n`)
    assert.equal(await withStoreLock(identity, async () => 'reclaimed own stranded lock'), 'reclaimed own stranded lock')
  })
})

test('store lock serializes concurrent callers in one process and stays usable afterwards', async () => {
  await withHome(async () => {
    const lock = path.join(snapshotStoreDir(identity), 'lock')
    let active = 0
    let peak = 0
    const work = (ms: number) => withStoreLock(identity, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, ms))
      const nested = await withStoreLock(identity, async () => 'nested')
      active--
      return nested
    })
    assert.deepEqual(await Promise.all([work(30), work(5), work(1)]), ['nested', 'nested', 'nested'])
    assert.equal(peak, 1)
    await assert.rejects(fs.access(lock))
    const holder = await withStoreLock(identity, async () => (await fs.readFile(lock, 'utf8')).trim())
    assert.equal(holder, String(process.pid))
  })
})

async function writeVault(): Promise<void> {
  const ref = continuityVaultRef(identity)
  await fs.mkdir(path.join(ref.skillsDir, 'alpha', '__pycache__'), { recursive: true })
  await fs.mkdir(path.join(ref.skillsDir, 'alpha', 'assets'), { recursive: true })
  await fs.mkdir(path.join(ref.skillsDir, 'notes'), { recursive: true })
  await fs.writeFile(ref.soulPath, tricky['SOUL.md'])
  await fs.writeFile(ref.memoryPath, tricky['MEMORY.md'])
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'SKILL.md'), '﻿---\r\nname: alpha\r\ndescription: does alpha things\r\n---\r\n\r\nbody\r\n')
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', '__pycache__', 'x.cpython-312.pyc'), Buffer.from([0xff, 0x00, 0x13]))
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'assets', 'bank.json'), JSON.stringify({ strokes: 'x'.repeat(1024 * 1024) }))
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'assets', 'huge.json'), 'y'.repeat(3 * 1024 * 1024))
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'assets', 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]))
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'bad name.md'), 'x')
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', '.hidden'), 'x')
  await fs.writeFile(path.join(ref.skillsDir, 'notes', 'todo.md'), 'not a skill')
}

async function snapshotDisk(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (current: string): Promise<void> => {
    for (const ent of await fs.readdir(current, { withFileTypes: true })) {
      const abs = path.join(current, ent.name)
      if (ent.isDirectory()) await walk(abs)
      else {
        const stat = await fs.stat(abs)
        out[path.relative(dir, abs)] = `${stat.mtimeMs}:${(await fs.readFile(abs)).toString('base64')}`
      }
    }
  }
  await walk(dir)
  return out
}

test('the pure working view writes nothing and reports what a save would leave out', async () => {
  await withHome(async () => {
    await writeVault()
    const ref = continuityVaultRef(identity)
    const before = await snapshotDisk(ref.dir)
    const view = await readPackedWorkingView(identity)
    assert.deepEqual(await snapshotDisk(ref.dir), before)
    assert.equal(view.ready, true)
    assert.ok(view.files['skills/alpha/assets/bank.json'], 'files under 2 MiB are packed')
    assert.ok(!Object.keys(view.files).some(key => key.includes('__pycache__')), 'build caches are never packed')
    assert.deepEqual(view.normalizesOnSave, ['skills/alpha/SKILL.md'])
    assert.ok(view.lossy.includes('skills/alpha/assets/icon.png'))
    const reasons = Object.fromEntries(view.skipped.map(skip => [skip.path, skip.reason]))
    assert.equal(reasons['skills/alpha/assets/huge.json'], 'too-large')
    assert.equal(reasons['skills/alpha/bad name.md'], 'unsupported-name')
    assert.equal(reasons['skills/notes/'], 'no-skill-file')
    assert.ok(!Object.keys(reasons).some(key => key.includes('.hidden')))
    assert.deepEqual(view.warnings, ['legacy-skill-layout', 'agent-card-stale'])
  })
})

test('the pure working view matches what the effectful save pipeline packs', async () => {
  await withHome(async () => {
    await writeVault()
    await fs.rm(path.join(continuityVaultRef(identity).skillsDir, 'notes'), { recursive: true })
    const view = await readPackedWorkingView(identity)
    const legacyFromView = continuitySnapshotContentHashesFromSources({
      privateFiles: view.sources.privateFiles,
      agentCard: view.sources.agentCard,
      skills: view.sources.skills,
    })
    const privateFiles = await readContinuityFiles(identity)
    const agentCard = await syncAgentCardManifest(identity)
    const skills = await loadSkillsTree(identity)
    assert.deepEqual(view.files, packedFileMap({ privateFiles, agentCard, skills }))
    assert.deepEqual(legacyFromView, await localContinuitySnapshotContentHashes(identity))
  })
})

test('a save keeps exactly what it packed, and only when it has the packed bytes', async () => {
  await withHome(async () => {
    await writeVault()
    await fs.rm(path.join(continuityVaultRef(identity).skillsDir, 'notes'), { recursive: true })
    const saved: EthagentIdentity = {
      ...identity,
      backup: { cid: 'bafysaved', createdAt: '2026-01-01T00:00:00.000Z', envelopeVersion: '1', ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files', status: 'pinned' },
    } as EthagentIdentity
    await markCurrentContinuityFilesPublished(saved)
    assert.equal(await readSnapshotManifest(saved, 'bafysaved'), null)
    const view = await readPackedWorkingView(saved)
    await markCurrentContinuityFilesPublished(saved, view.sources)
    const manifest = await readSnapshotManifest(saved, 'bafysaved')
    assert.equal(manifest?.kind, 'snapshot')
    if (manifest?.kind === 'snapshot') {
      const read = await readEntryBytes(saved, manifest.files)
      assert.deepEqual(Object.keys(read.files).sort(), Object.keys(view.files).sort())
      for (const [key, value] of Object.entries(view.files)) {
        assert.equal(Buffer.from(read.files[key]!).toString('utf8'), value)
      }
    }
  })
})

test('a restore checkpoint captures the vault before it is overwritten', async () => {
  await withHome(async () => {
    await writeVault()
    await checkpointBeforeRestore(identity, 'bafytarget')
    const [checkpoint] = await listCheckpoints(identity)
    assert.equal(checkpoint!.reason, 'pre-restore')
    assert.equal(checkpoint!.scope, 'vault')
    const read = await readEntryBytes(identity, checkpoint!.files)
    assert.equal(Buffer.from(read.files['SOUL.md']!).toString('utf8'), tricky['SOUL.md'])
    assert.ok(read.files['skills/alpha/assets/icon.png'], 'raw bytes are kept even for files a save would garble')
    assert.ok(!Object.keys(read.files).some(key => key.includes('__pycache__')))
  })
})
