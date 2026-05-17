import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  continuityVaultRef,
  continuityVaultStatus,
  continuityWorkingTreeStatus,
  defaultContinuityFiles,
  ensureContinuityFiles,
  ensureIdentityMarkdownScaffold,
  ensureAgentCardFile,
  readAgentCardFile,
  readContinuityFiles,
  syncIdentityMarkdownScaffold,
  writeIdentityMarkdownScaffold,
  writeAgentCardFile,
  writeContinuityFiles,
} from '../../../src/identity/continuity/storage.js'
import {
  recordPrivateContinuityHistorySnapshot,
  restorePrivateContinuityHistorySnapshot,
} from '../../../src/identity/continuity/history.js'
import {
  listPublishedContinuitySnapshots,
  recordPublishedContinuitySnapshot,
  updatePublishedContinuitySnapshotContentHashes,
} from '../../../src/identity/continuity/snapshots.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'

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

test('continuity storage creates private default SOUL and MEMORY files in a continuity vault', async () => {
  await withHome(async home => {
    const files = await ensureContinuityFiles(identity)
    const ref = continuityVaultRef(identity)

    assert.ok(ref.dir.startsWith(path.join(home, '.ethagent', 'continuity')))
    assert.match(files['SOUL.md'], /^# SOUL\.md/)
    assert.match(files['SOUL.md'], /Owner wallet: 0x000000000000000000000000000000000000dEaD/)
    assert.match(files['SOUL.md'], /ERC-8004 token: #42/)
    assert.match(files['SOUL.md'], /## Persona/)
    assert.match(files['SOUL.md'], /## Principles/)
    assert.match(files['SOUL.md'], /Never store seed phrases/)
    assert.match(files['MEMORY.md'], /^# MEMORY\.md/)
    assert.match(files['MEMORY.md'], /## Durable User Preferences/)
    assert.match(files['MEMORY.md'], /## Project Context/)
    assert.match(files['MEMORY.md'], /Never store seed phrases/)
    assert.equal((await continuityVaultStatus(identity)).ready, true)
  })
})

test('identity scaffold creates SOUL, MEMORY, and agent-card.json files for a linked agent', async () => {
  await withHome(async () => {
    const files = await ensureIdentityMarkdownScaffold(identity)
    const ref = continuityVaultRef(identity)

    assert.match(files['SOUL.md'], /^# SOUL\.md/)
    assert.match(files['MEMORY.md'], /^# MEMORY\.md/)
    assert.match(files['agent-card.json'], /"protocolVersion": "0\.3\.0"/)
    assert.match(files['agent-card.json'], /"producer"/)
    await fs.access(ref.soulPath)
    await fs.access(ref.memoryPath)
    await fs.access(ref.agentCardPath)
    assert.equal((await continuityVaultStatus(identity)).ready, true)
  })
})

test('identity continuity sync updates generated profile blocks without overwriting notes', async () => {
  await withHome(async () => {
    const scaffold = await ensureIdentityMarkdownScaffold(identity)
    await writeContinuityFiles(identity, {
      'SOUL.md': `${scaffold['SOUL.md']}\n## Owner Notes\n- keep soul note\n`,
      'MEMORY.md': `${scaffold['MEMORY.md']}\n## Owner Notes\n- keep memory note\n`,
    })
    await writeAgentCardFile(identity, `${scaffold['agent-card.json']}\n## Owner Notes\n- keep public note\n`)

    const renamed: EthagentIdentity = {
      ...identity,
      state: { ...identity.state, name: 'renamed agent', description: 'new public description' },
    }
    const synced = await syncIdentityMarkdownScaffold(renamed)

    assert.match(synced['SOUL.md'], /^# SOUL\.md/)
    assert.doesNotMatch(synced['SOUL.md'], /Agent name: renamed agent/)
    assert.doesNotMatch(synced['SOUL.md'], /Public description: new public description/)
    assert.match(synced['SOUL.md'], /keep soul note/)
    assert.match(synced['MEMORY.md'], /^# MEMORY\.md/)
    assert.doesNotMatch(synced['MEMORY.md'], /Agent name: renamed agent/)
    assert.match(synced['MEMORY.md'], /keep memory note/)
    assert.match(synced['agent-card.json'], /"name": "renamed agent"/)
    assert.match(synced['agent-card.json'], /"description": "new public description"/)
  })
})

test('identity continuity sync updates and removes generated icon references in agent-card.json', async () => {
  await withHome(async () => {
    await writeAgentCardFile(identity, JSON.stringify({
      protocolVersion: '0.3.0',
      name: 'old agent',
      description: 'old description',
      image: 'ipfs://old-icon.png',
      skills: [{ id: 'custom', name: 'Custom', description: 'Keep custom skills', inputModes: ['text/plain'], outputModes: ['text/plain'] }],
    }, null, 2))

    const updatedIcon: EthagentIdentity = {
      ...identity,
      state: { ...identity.state, imageUrl: 'https://example.com/new-icon.png' },
    }
    const updated = JSON.parse((await syncIdentityMarkdownScaffold(updatedIcon))['agent-card.json'])

    assert.equal(updated.image, 'https://example.com/new-icon.png')
    assert.deepEqual(updated.skills, [])

    const removedIcon: EthagentIdentity = {
      ...identity,
      state: { ...identity.state },
    }
    const removed = JSON.parse((await syncIdentityMarkdownScaffold(removedIcon))['agent-card.json'])

    assert.equal(Object.hasOwn(removed, 'image'), false)
    assert.deepEqual(removed.skills, [])
  })
})

test('identity continuity scaffold writes the exact prepared mint scaffold', async () => {
  await withHome(async () => {
    await writeIdentityMarkdownScaffold(identity, {
      'SOUL.md': '# Prepared Soul\nminted soul\n',
      'MEMORY.md': '# Prepared Memory\nminted memory\n',
      'agent-card.json': '{\n  "protocolVersion": "0.3.0",\n  "name": "minted card"\n}\n',
    })

    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Prepared Soul\nminted soul\n',
      'MEMORY.md': '# Prepared Memory\nminted memory\n',
    })
    assert.equal(await readAgentCardFile(identity), '{\n  "protocolVersion": "0.3.0",\n  "name": "minted card"\n}\n')
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

test('agent card file hydrates from a published fallback without overwriting local edits', async () => {
  await withHome(async () => {
    let fallbackReads = 0
    const first = await ensureAgentCardFile(identity, {
      fallback: async () => {
        fallbackReads += 1
        return '# Published Card\npublic profile\n'
      },
    })

    assert.equal(first, '# Published Card\npublic profile\n')
    assert.equal(fallbackReads, 1)

    await writeAgentCardFile(identity, '{"protocolVersion":"0.3.0","name":"Local Card"}')
    const second = await ensureAgentCardFile(identity, {
      fallback: async () => {
        fallbackReads += 1
        return '# Should Not Load\n'
      },
    })

    assert.equal(second, '{"protocolVersion":"0.3.0","name":"Local Card"}\n')
    assert.equal(await readAgentCardFile(identity), '{"protocolVersion":"0.3.0","name":"Local Card"}\n')
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
    await writeAgentCardFile(identity, '{"protocolVersion":"0.3.0","name":"Old Card"}')

    const snapshot = await recordPrivateContinuityHistorySnapshot({
      identity,
      file: 'MEMORY.md',
      filePath: ref.memoryPath,
      existedBefore: true,
      previousContent: '# Old Memory\nprivate memory\n',
      previousFiles: await readContinuityFiles(identity),
      previousAgentCard: await readAgentCardFile(identity),
      changeSummary: 'append private memory',
      createdAt: '2026-04-21T00:00:00.000Z',
    })

    await writeContinuityFiles(identity, {
      'SOUL.md': '# New Soul\nchanged soul\n',
      'MEMORY.md': '# New Memory\nchanged memory\n',
    })
    await writeAgentCardFile(identity, '{"protocolVersion":"0.3.0","name":"New Card"}')

    await restorePrivateContinuityHistorySnapshot(identity, snapshot.id)

    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Old Soul\nprivate soul\n',
      'MEMORY.md': '# Old Memory\nprivate memory\n',
    })
    assert.equal(await readAgentCardFile(identity), '{"protocolVersion":"0.3.0","name":"Old Card"}\n')
  })
})

test('published snapshot list enriches current entries with agent card metadata', async () => {
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
      agentCard: {
        cid: 'bafycard',
        status: 'pinned',
      },
    })

    assert.equal(list.length, 1)
    assert.equal(list[0]!.cid, 'bafybackup')
    assert.equal(list[0]!.agentCardCid, 'bafycard')
  })
})

test('working tree status compares local markdown to published snapshot hashes', async () => {
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
      agentCard: {
        cid: 'bafycard',
        status: 'pinned',
      },
    }
    await writeIdentityMarkdownScaffold(publishedIdentity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
      'agent-card.json': '{"protocolVersion":"0.3.0","name":"Card"}',
    })
    await recordPublishedContinuitySnapshot({ identity: publishedIdentity })
    const [published] = await listPublishedContinuitySnapshots(publishedIdentity)

    assert.equal((await continuityWorkingTreeStatus(publishedIdentity, published)).publishState, 'published')

    await writeContinuityFiles(publishedIdentity, {
      'SOUL.md': '# Soul\nchanged soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
    const changed = await continuityWorkingTreeStatus(publishedIdentity, published)
    assert.equal(changed.publishState, 'local-changes')
    assert.equal(changed.localChangedAfterBackup, true)
  })
})

test('working tree status asks to verify legacy snapshots without recorded hashes', async () => {
  await withHome(async () => {
    const legacyIdentity: EthagentIdentity = {
      ...identity,
      backup: {
        cid: 'bafybackup',
        createdAt: '2026-04-21T00:00:00.000Z',
        envelopeVersion: 'ethagent.continuity.v1',
        ipfsApiUrl: 'https://ipfs.example',
        status: 'pinned',
      },
    }
    await ensureIdentityMarkdownScaffold(legacyIdentity)
    const [published] = await listPublishedContinuitySnapshots(legacyIdentity)

    assert.equal((await continuityWorkingTreeStatus(legacyIdentity, published)).publishState, 'verify-needed')
  })
})

test('published snapshot hashes can be backfilled after verification', async () => {
  await withHome(async () => {
    const legacyIdentity: EthagentIdentity = {
      ...identity,
      backup: {
        cid: 'bafybackup',
        createdAt: '2026-04-21T00:00:00.000Z',
        envelopeVersion: 'ethagent.continuity.v1',
        ipfsApiUrl: 'https://ipfs.example',
        status: 'pinned',
      },
    }
    await writeIdentityMarkdownScaffold(legacyIdentity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
      'agent-card.json': '{"protocolVersion":"0.3.0","name":"Card"}',
    })
    const current = await continuityWorkingTreeStatus(legacyIdentity)
    assert.ok(current.localContentHashes)

    const refreshedIdentity: EthagentIdentity = {
      ...legacyIdentity,
      agentCard: {
        cid: 'bafyrefreshedcard',
        status: 'pinned',
      },
    }
    await updatePublishedContinuitySnapshotContentHashes(refreshedIdentity, 'bafybackup', current.localContentHashes)
    const [published] = await listPublishedContinuitySnapshots(refreshedIdentity)

    assert.equal(published?.contentHashes?.['agent-card.json'], current.localContentHashes['agent-card.json'])
    assert.equal(published?.agentCardCid, 'bafyrefreshedcard')
    assert.equal((await continuityWorkingTreeStatus(legacyIdentity, published)).publishState, 'published')
  })
})

test('published snapshot hashes can be refreshed after refetch restores agent card', async () => {
  await withHome(async () => {
    const restoredIdentity: EthagentIdentity = {
      ...identity,
      backup: {
        cid: 'bafybackup',
        createdAt: '2026-04-21T00:00:00.000Z',
        envelopeVersion: 'ethagent.continuity.v1',
        ipfsApiUrl: 'https://ipfs.example',
        status: 'restored',
      },
      agentCard: {
        cid: 'bafycard',
        status: 'pinned',
      },
    }
    await writeIdentityMarkdownScaffold(restoredIdentity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
      'agent-card.json': '{"protocolVersion":"0.3.0","name":"Old Card"}',
    })
    await recordPublishedContinuitySnapshot({ identity: restoredIdentity })
    const [stalePublished] = await listPublishedContinuitySnapshots(restoredIdentity)

    await writeContinuityFiles(restoredIdentity, {
      'SOUL.md': '# Soul\nrestored soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
    const staleStatus = await continuityWorkingTreeStatus(restoredIdentity, stalePublished)
    assert.equal(staleStatus.publishState, 'local-changes')

    assert.ok(staleStatus.localContentHashes)
    await updatePublishedContinuitySnapshotContentHashes(restoredIdentity, 'bafybackup', staleStatus.localContentHashes)
    const [freshPublished] = await listPublishedContinuitySnapshots(restoredIdentity)

    assert.equal((await continuityWorkingTreeStatus(restoredIdentity, freshPublished)).publishState, 'published')
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
