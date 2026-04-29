import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  continuityVaultRef,
  continuityVaultStatus,
  defaultContinuityFiles,
  ensureContinuityFiles,
  ensureIdentityMarkdownScaffold,
  ensurePublicSkillsFile,
  readPublicSkillsFile,
  readContinuityFiles,
  syncIdentityMarkdownScaffold,
  writeIdentityMarkdownScaffold,
  writePublicSkillsFile,
  writeContinuityFiles,
} from '../src/identity/continuity/storage.js'
import {
  recordPrivateContinuityHistorySnapshot,
  restorePrivateContinuityHistorySnapshot,
} from '../src/identity/continuity/history.js'
import {
  listPublishedContinuitySnapshots,
  recordPublishedContinuitySnapshot,
} from '../src/identity/continuity/snapshots.js'
import type { EthagentIdentity } from '../src/storage/config.js'

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

test('continuity storage creates private default SOUL and MEMORY files in an agent vault', async () => {
  await withHome(async home => {
    const files = await ensureContinuityFiles(identity)
    const ref = continuityVaultRef(identity)

    assert.ok(ref.dir.startsWith(path.join(home, '.ethagent', 'continuity')))
    assert.match(files['SOUL.md'], /test agent Soul/)
    assert.match(files['SOUL.md'], /Owner wallet: 0x000000000000000000000000000000000000dEaD/)
    assert.match(files['SOUL.md'], /ERC-8004 token: #42/)
    assert.match(files['MEMORY.md'], /test agent Memory/)
    assert.equal((await continuityVaultStatus(identity)).ready, true)
  })
})

test('identity markdown scaffold creates SOUL, MEMORY, and SKILLS files for a linked agent', async () => {
  await withHome(async () => {
    const files = await ensureIdentityMarkdownScaffold(identity)
    const ref = continuityVaultRef(identity)

    assert.match(files['SOUL.md'], /test agent Soul/)
    assert.match(files['MEMORY.md'], /test agent Memory/)
    assert.match(files['SKILLS.md'], /# test agent Skills/)
    assert.match(files['SKILLS.md'], /ethagent\.public-skills\.v1/)
    assert.match(files['SKILLS.md'], /public ERC-8004 discovery metadata/)
    await fs.access(ref.soulPath)
    await fs.access(ref.memoryPath)
    await fs.access(ref.publicSkillsPath)
    assert.equal((await continuityVaultStatus(identity)).ready, true)
  })
})

test('identity markdown sync updates generated profile blocks without overwriting notes', async () => {
  await withHome(async () => {
    const scaffold = await ensureIdentityMarkdownScaffold(identity)
    await writeContinuityFiles(identity, {
      'SOUL.md': `${scaffold['SOUL.md']}\n## Owner Notes\n- keep soul note\n`,
      'MEMORY.md': `${scaffold['MEMORY.md']}\n## Owner Notes\n- keep memory note\n`,
    })
    await writePublicSkillsFile(identity, `${scaffold['SKILLS.md']}\n## Owner Notes\n- keep public note\n`)

    const renamed: EthagentIdentity = {
      ...identity,
      state: { ...identity.state, name: 'renamed agent', description: 'new public description' },
    }
    const synced = await syncIdentityMarkdownScaffold(renamed)

    assert.match(synced['SOUL.md'], /^# renamed agent Soul/)
    assert.match(synced['SOUL.md'], /Agent name: renamed agent/)
    assert.match(synced['SOUL.md'], /Public description: new public description/)
    assert.match(synced['SOUL.md'], /keep soul note/)
    assert.match(synced['MEMORY.md'], /^# renamed agent Memory/)
    assert.match(synced['MEMORY.md'], /Agent name: renamed agent/)
    assert.match(synced['MEMORY.md'], /keep memory note/)
    assert.match(synced['SKILLS.md'], /^# renamed agent Skills/)
    assert.match(synced['SKILLS.md'], /"name": "renamed agent"/)
    assert.match(synced['SKILLS.md'], /"description": "new public description"/)
    assert.match(synced['SKILLS.md'], /keep public note/)
  })
})

test('identity markdown scaffold writes the exact prepared mint scaffold', async () => {
  await withHome(async () => {
    await writeIdentityMarkdownScaffold(identity, {
      'SOUL.md': '# Prepared Soul\nminted soul\n',
      'MEMORY.md': '# Prepared Memory\nminted memory\n',
      'SKILLS.md': '# Prepared Skills\nminted skills\n',
    })

    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Prepared Soul\nminted soul\n',
      'MEMORY.md': '# Prepared Memory\nminted memory\n',
    })
    assert.equal(await readPublicSkillsFile(identity), '# Prepared Skills\nminted skills\n')
  })
})

test('continuity storage writes local private working files without a lock/delete flow', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })

    assert.equal((await continuityVaultStatus(identity)).ready, true)
    assert.notDeepEqual(await readContinuityFiles(identity), defaultContinuityFiles(identity))
  })
})

test('public skills file hydrates from a published fallback without overwriting local edits', async () => {
  await withHome(async () => {
    let fallbackReads = 0
    const first = await ensurePublicSkillsFile(identity, {
      fallback: async () => {
        fallbackReads += 1
        return '# Published Skills\npublic profile\n'
      },
    })

    assert.equal(first, '# Published Skills\npublic profile\n')
    assert.equal(fallbackReads, 1)

    await writePublicSkillsFile(identity, '# Local Skills\nedited locally\n')
    const second = await ensurePublicSkillsFile(identity, {
      fallback: async () => {
        fallbackReads += 1
        return '# Should Not Load\n'
      },
    })

    assert.equal(second, '# Local Skills\nedited locally\n')
    assert.equal(await readPublicSkillsFile(identity), '# Local Skills\nedited locally\n')
    assert.equal(fallbackReads, 1)
  })
})

test('private continuity history restore restores the full markdown checkpoint', async () => {
  await withHome(async () => {
    const ref = continuityVaultRef(identity)
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Old Soul\nprivate soul\n',
      'MEMORY.md': '# Old Memory\nprivate memory\n',
    })
    await writePublicSkillsFile(identity, '# Old Skills\npublic skills\n')

    const snapshot = await recordPrivateContinuityHistorySnapshot({
      identity,
      file: 'MEMORY.md',
      filePath: ref.memoryPath,
      existedBefore: true,
      previousContent: '# Old Memory\nprivate memory\n',
      previousFiles: await readContinuityFiles(identity),
      previousPublicSkills: await readPublicSkillsFile(identity),
      changeSummary: 'append private memory',
      createdAt: '2026-04-21T00:00:00.000Z',
    })

    await writeContinuityFiles(identity, {
      'SOUL.md': '# New Soul\nchanged soul\n',
      'MEMORY.md': '# New Memory\nchanged memory\n',
    })
    await writePublicSkillsFile(identity, '# New Skills\nchanged skills\n')

    await restorePrivateContinuityHistorySnapshot(identity, snapshot.id)

    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Old Soul\nprivate soul\n',
      'MEMORY.md': '# Old Memory\nprivate memory\n',
    })
    assert.equal(await readPublicSkillsFile(identity), '# Old Skills\npublic skills\n')
  })
})

test('published snapshot list enriches current entries with public skills metadata', async () => {
  await withHome(async () => {
    const publishedIdentity: EthagentIdentity = {
      ...identity,
      backup: {
        cid: 'bafybackup',
        createdAt: '2026-04-21T00:00:00.000Z',
        envelopeVersion: 'ethagent.continuity.v1',
        ipfsApiUrl: 'https://ipfs.example',
        status: 'pinned',
      },
    }
    await recordPublishedContinuitySnapshot({ identity: publishedIdentity, label: 'legacy snapshot' })

    const list = await listPublishedContinuitySnapshots({
      ...publishedIdentity,
      publicSkills: {
        cid: 'bafyskills',
        agentCardCid: 'bafycard',
        status: 'pinned',
      },
    })

    assert.equal(list.length, 1)
    assert.equal(list[0]!.cid, 'bafybackup')
    assert.equal(list[0]!.publicSkillsCid, 'bafyskills')
    assert.equal(list[0]!.agentCardCid, 'bafycard')
  })
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-continuity-'))
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
