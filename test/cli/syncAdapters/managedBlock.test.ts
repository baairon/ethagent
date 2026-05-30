import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { reconcileSoulMemory } from '../../../src/cli/sync.js'
import { claudeCodeAdapter } from '../../../src/cli/syncAdapters/claude-code.js'
import { codexAdapter } from '../../../src/cli/syncAdapters/codex.js'
import { parseManagedContext, removeManagedBlock } from '../../../src/cli/syncAdapters/managedBlock.js'
import { continuityVaultRef, readContinuityFiles, writeContinuityFiles } from '../../../src/identity/continuity/storage.js'
import type { SkillIndexEntry } from '../../../src/identity/continuity/skills/types.js'
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

async function seedVault(soulBody: string, memoryBody: string): Promise<void> {
  await writeContinuityFiles(identity, {
    'SOUL.md': `# SOUL.md\n\n${soulBody}\n`,
    'MEMORY.md': `# MEMORY.md\n\n${memoryBody}\n`,
  })
}

async function claudeMdPath(): Promise<string> {
  return path.join(os.homedir(), '.claude', 'CLAUDE.md')
}

async function touch(file: string, mtimeMs: number): Promise<void> {
  const when = new Date(mtimeMs)
  await fs.utimes(file, when, when)
}

test('claude-code mirror injects soul and memory sub-marker blocks', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }
    await claudeCodeAdapter.mirror([], context)

    const claudeMd = await fs.readFile(await claudeMdPath(), 'utf8')
    assert.match(claudeMd, /<!-- ethagent:soul:start -->/)
    assert.match(claudeMd, /<!-- ethagent:memory:start -->/)
    const parsed = parseManagedContext(claudeMd)
    assert.equal(parsed.soul, 'original soul body')
    assert.equal(parsed.memory, 'original memory body')
  })
})

test('reconcile pulls a newer edited claude block back into the vault', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }
    await claudeCodeAdapter.mirror([], context)

    const claudeFile = await claudeMdPath()
    const edited = (await fs.readFile(claudeFile, 'utf8')).replace('original soul body', 'edited by claude')
    await fs.writeFile(claudeFile, edited, 'utf8')

    const ref = continuityVaultRef(identity)
    await touch(ref.soulPath, 1_000)
    await touch(claudeFile, 2_000)

    const result = await reconcileSoulMemory(identity, [claudeCodeAdapter])

    const files = await readContinuityFiles(identity)
    assert.equal(files['SOUL.md'], '# SOUL.md\n\nedited by claude\n')
    assert.equal(result.soul, '# SOUL.md\n\nedited by claude\n')
    assert.deepEqual(result.pulled, ['SOUL.md'])
    assert.equal(files['MEMORY.md'], '# MEMORY.md\n\noriginal memory body\n')
  })
})

test('reconcile is idempotent when the block matches the vault regardless of mtime', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }
    await claudeCodeAdapter.mirror([], context)

    const ref = continuityVaultRef(identity)
    await touch(ref.soulPath, 1_000)
    await touch(await claudeMdPath(), 9_000)

    const before = await readContinuityFiles(identity)
    const result = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    const after = await readContinuityFiles(identity)
    assert.deepEqual(after, before)
    assert.deepEqual(result.pulled, [])
  })
})

test('reconcile keeps the vault when it is newer than an edited block', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }
    await claudeCodeAdapter.mirror([], context)

    const claudeFile = await claudeMdPath()
    const edited = (await fs.readFile(claudeFile, 'utf8')).replace('original soul body', 'stale harness edit')
    await fs.writeFile(claudeFile, edited, 'utf8')

    const ref = continuityVaultRef(identity)
    await touch(claudeFile, 1_000)
    await touch(ref.soulPath, 5_000)

    const result = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    const files = await readContinuityFiles(identity)
    assert.equal(files['SOUL.md'], '# SOUL.md\n\noriginal soul body\n')
    assert.deepEqual(result.pulled, [])
  })
})

test('reconcile does not clobber a fresh vault edit when an unchanged harness file mtime is newer', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }
    await claudeCodeAdapter.mirror([], context)

    await writeContinuityFiles(identity, {
      'SOUL.md': '# SOUL.md\n\nfresh vault edit\n',
      'MEMORY.md': '# MEMORY.md\n\noriginal memory body\n',
    })

    const ref = continuityVaultRef(identity)
    const claudeFile = await claudeMdPath()
    await touch(ref.soulPath, 1_000)
    await touch(claudeFile, 9_000)

    const result = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    const files = await readContinuityFiles(identity)
    assert.equal(files['SOUL.md'], '# SOUL.md\n\nfresh vault edit\n')
    assert.deepEqual(result.pulled, [])
  })
})

test('reconcile does not spuriously pull when the on-disk block collapses multi-blank-line spacing', async () => {
  await withHome(async () => {
    const soul = '# SOUL.md\n\nfirst section\n\n\n\nsecond section\n'
    await writeContinuityFiles(identity, { 'SOUL.md': soul, 'MEMORY.md': '# MEMORY.md\n\noriginal memory body\n' })
    const context = { soul, memory: '# MEMORY.md\n\noriginal memory body\n' }
    await claudeCodeAdapter.mirror([], context)

    const ref = continuityVaultRef(identity)
    const claudeFile = await claudeMdPath()
    await touch(ref.soulPath, 1_000)
    await touch(claudeFile, 9_000)

    const result = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    const files = await readContinuityFiles(identity)
    assert.equal(files['SOUL.md'], soul)
    assert.deepEqual(result.pulled, [])
  })
})

test('codex renders public skills outside the soul/memory sub-markers and reconcile ignores them', async () => {
  await withHome(async home => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }

    const skillPath = path.join(home, 'skill.md')
    await fs.writeFile(skillPath, '---\nname: demo\ndescription: A demo skill\n---\ndemo skill body\n', 'utf8')
    const skill: SkillIndexEntry = {
      name: 'demo',
      description: 'A demo skill',
      visibility: 'public',
      relativePath: 'demo/SKILL.md',
      absolutePath: skillPath,
    }
    await codexAdapter.mirror([skill], context)

    const agentsFile = path.join(os.homedir(), '.codex', 'AGENTS.md')
    const agents = await fs.readFile(agentsFile, 'utf8')
    assert.match(agents, /## demo/)
    assert.match(agents, /demo skill body/)
    const parsed = parseManagedContext(agents)
    assert.equal(parsed.soul, 'original soul body')
    assert.equal(parsed.memory, 'original memory body')

    const ref = continuityVaultRef(identity)
    await touch(ref.soulPath, 5_000)
    await touch(agentsFile, 1_000)
    await reconcileSoulMemory(identity, [codexAdapter])
    const files = await readContinuityFiles(identity)
    assert.equal(files['SOUL.md'], '# SOUL.md\n\noriginal soul body\n')
  })
})

test('a full reconcile-then-push cycle converges and a second sync is a no-op', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const context = { soul: `# SOUL.md\n\noriginal soul body\n`, memory: `# MEMORY.md\n\noriginal memory body\n` }
    await claudeCodeAdapter.mirror([], context)

    const claudeFile = await claudeMdPath()
    const edited = (await fs.readFile(claudeFile, 'utf8')).replace('original soul body', 'edited by claude')
    await fs.writeFile(claudeFile, edited, 'utf8')

    const ref = continuityVaultRef(identity)
    await touch(ref.soulPath, 1_000)
    await touch(claudeFile, 2_000)

    const firstPass = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    assert.deepEqual(firstPass.pulled, ['SOUL.md'])
    await claudeCodeAdapter.mirror([], firstPass)

    const claudeAfterPush = parseManagedContext(await fs.readFile(claudeFile, 'utf8'))
    assert.equal(claudeAfterPush.soul, 'edited by claude')

    const second = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    assert.equal(second.soul, '# SOUL.md\n\nedited by claude\n')
    assert.deepEqual(second.pulled, [])
    assert.equal((await readContinuityFiles(identity))['SOUL.md'], '# SOUL.md\n\nedited by claude\n')
  })
})

test('old-format blocks without sub-markers fall back to vault-wins', async () => {
  await withHome(async () => {
    await seedVault('original soul body', 'original memory body')
    const claudeDir = path.join(os.homedir(), '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    const claudeFile = path.join(claudeDir, 'CLAUDE.md')
    await fs.writeFile(
      claudeFile,
      '<!-- ethagent:start -->\nlegacy merged soul and memory\n<!-- ethagent:end -->\n',
      'utf8',
    )

    const ref = continuityVaultRef(identity)
    await touch(claudeFile, 9_000)
    await touch(ref.soulPath, 1_000)

    const result = await reconcileSoulMemory(identity, [claudeCodeAdapter])
    assert.equal(result.soul, '# SOUL.md\n\noriginal soul body\n')
    const files = await readContinuityFiles(identity)
    assert.equal(files['SOUL.md'], '# SOUL.md\n\noriginal soul body\n')
  })
})

test('removeManagedBlock strips only the ethagent block and keeps surrounding content and foreign markers', async () => {
  await withHome(async home => {
    const file = path.join(home, 'CLAUDE.md')
    await fs.writeFile(
      file,
      [
        '# My own notes',
        '',
        '<!-- other-tool:start -->',
        'keep me',
        '<!-- other-tool:end -->',
        '',
        '<!-- ethagent:start -->',
        '<!-- ethagent:soul:start -->',
        'soul body',
        '<!-- ethagent:soul:end -->',
        '<!-- ethagent:end -->',
        '',
        'trailing user text',
        '',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(home, '.ethagent-sync.json'), '{"soulHash":"x"}\n', 'utf8')

    const removed = await removeManagedBlock(file)
    assert.equal(removed, true)

    const after = await fs.readFile(file, 'utf8')
    assert.doesNotMatch(after, /ethagent:start/)
    assert.doesNotMatch(after, /soul body/)
    assert.match(after, /# My own notes/)
    assert.match(after, /<!-- other-tool:start -->/)
    assert.match(after, /keep me/)
    assert.match(after, /trailing user text/)

    await assert.rejects(fs.access(path.join(home, '.ethagent-sync.json')))
  })
})

test('removeManagedBlock deletes the file when the block was its only content', async () => {
  await withHome(async home => {
    const file = path.join(home, 'CLAUDE.md')
    await fs.writeFile(file, '<!-- ethagent:start -->\nsoul body\n<!-- ethagent:end -->\n', 'utf8')

    const removed = await removeManagedBlock(file)
    assert.equal(removed, true)
    await assert.rejects(fs.access(file))
  })
})

test('removeManagedBlock is a no-op when the file is missing or has no ethagent markers', async () => {
  await withHome(async home => {
    const missing = path.join(home, 'nope.md')
    assert.equal(await removeManagedBlock(missing), false)

    const file = path.join(home, 'CLAUDE.md')
    const content = '# just my notes\n\n<!-- other-tool:start -->\nx\n<!-- other-tool:end -->\n'
    await fs.writeFile(file, content, 'utf8')
    assert.equal(await removeManagedBlock(file), false)
    assert.equal(await fs.readFile(file, 'utf8'), content)
  })
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-sync-'))
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
