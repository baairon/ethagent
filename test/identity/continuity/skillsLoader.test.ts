import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  invalidateSkillsCache,
  listSkills,
  listSkillFiles,
} from '../../../src/identity/continuity/skills/loadSkills.js'
import {
  continuityVaultRef,
  ensureContinuityVault,
} from '../../../src/identity/continuity/storage.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  chainId: 1,
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
  agentId: '42',
  state: { name: 'test agent' },
}

test('listSkills reads canonical <skill>/SKILL.md and reflects edits without cache invalidation', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'outline')
    const skillFile = path.join(skillDir, 'SKILL.md')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })

    await fs.writeFile(skillFile, [
      '---',
      'description: first description',
      'visibility: private',
      '---',
      '',
      'body v1',
      '',
    ].join('\n'), { mode: 0o600 })

    const first = await listSkills(identity)
    assert.equal(first.length, 1)
    assert.equal(first[0]?.description, 'first description')
    assert.equal(first[0]?.name, 'outline')
    assert.equal(first[0]?.relativePath, 'outline/SKILL.md')

    await new Promise(resolve => setTimeout(resolve, 20))

    await fs.writeFile(skillFile, [
      '---',
      'description: second description',
      'visibility: private',
      '---',
      '',
      'body v2',
      '',
    ].join('\n'), { mode: 0o600 })

    const second = await listSkills(identity)
    assert.equal(second.length, 1)
    assert.equal(second[0]?.description, 'second description')
  })
})

test('listSkills returns cached entries when the tree has not changed', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const dir = path.join(ref.skillsDir, 'outline')
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(dir, 'SKILL.md'), '---\ndescription: cached\nvisibility: private\n---\n\nbody\n', { mode: 0o600 })

    const a = await listSkills(identity)
    const b = await listSkills(identity)
    assert.equal(a, b)
  })
})

test('listSkills migrates legacy <category>/<name>.md files into <category>-<name>/SKILL.md', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const categoryDir = path.join(ref.skillsDir, 'writing')
    await fs.mkdir(categoryDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(categoryDir, 'outline.md'), '---\ndescription: legacy flat\nvisibility: private\n---\n\nbody\n', { mode: 0o600 })

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, 'writing-outline')
    assert.equal(entries[0]?.relativePath, 'writing-outline/SKILL.md')

    await fs.access(path.join(ref.skillsDir, 'writing-outline', 'SKILL.md'))
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'writing', 'outline.md')))
  })
})

test('listSkills migrates legacy nested <category>/<skill>/SKILL.md preserving supporting files', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const oldSkillDir = path.join(ref.skillsDir, 'writing', 'outline')
    const oldReferencesDir = path.join(oldSkillDir, 'references')
    await fs.mkdir(oldReferencesDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(oldSkillDir, 'SKILL.md'), '---\ndescription: nested legacy\nvisibility: private\n---\n\nbody\n', { mode: 0o600 })
    await fs.writeFile(path.join(oldReferencesDir, 'api.md'), '# api notes\n', { mode: 0o600 })

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, 'writing-outline')
    assert.equal(entries[0]?.relativePath, 'writing-outline/SKILL.md')

    await fs.access(path.join(ref.skillsDir, 'writing-outline', 'SKILL.md'))
    await fs.access(path.join(ref.skillsDir, 'writing-outline', 'references', 'api.md'))
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'writing')))
  })
})

test('listSkills only recognises files named SKILL.md at the skill folder root', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'outline')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\ndescription: canonical\nvisibility: private\n---\n\nbody\n', { mode: 0o600 })
    await fs.writeFile(path.join(skillDir, 'notes.md'), '---\ndescription: sibling note\n---\n\nbody\n', { mode: 0o600 })

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, 'outline')
    assert.equal(entries[0]?.description, 'canonical')
  })
})

test('listSkillFiles enumerates SKILL.md and supporting files inside a skill folder', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'outline')
    const referencesDir = path.join(skillDir, 'references')
    await fs.mkdir(referencesDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\ndescription: with siblings\n---\n\nbody\n', { mode: 0o600 })
    await fs.writeFile(path.join(referencesDir, 'api.md'), '# api\n', { mode: 0o600 })

    const files = await listSkillFiles(identity, 'outline')
    const rels = files.map(f => f.relativePath).sort()
    assert.deepEqual(rels, ['SKILL.md', 'references/api.md'])
  })
})

test('listSkillFiles collisions in migration get -2 suffix', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const a = path.join(ref.skillsDir, 'coding', 'python')
    const b = path.join(ref.skillsDir, 'writing', 'python')
    await fs.mkdir(a, { recursive: true, mode: 0o700 })
    await fs.mkdir(b, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(a, 'SKILL.md'), '---\ndescription: a\n---\n\nbody\n', { mode: 0o600 })
    await fs.writeFile(path.join(b, 'SKILL.md'), '---\ndescription: b\n---\n\nbody\n', { mode: 0o600 })
    await fs.mkdir(path.join(ref.skillsDir, 'coding-python'), { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(ref.skillsDir, 'coding-python', 'SKILL.md'), '---\ndescription: existing\n---\n\nbody\n', { mode: 0o600 })

    const entries = await listSkills(identity)
    const names = entries.map(e => e.name).sort()
    assert.ok(names.includes('coding-python'))
    assert.ok(names.includes('coding-python-2') || names.includes('writing-python-2') || names.includes('writing-python'))
  })
})

test('listSkills adopts a bare <slug>.md dropped at the skills/ root into <slug>/SKILL.md', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    await fs.writeFile(
      path.join(ref.skillsDir, 'video-downloader.md'),
      '---\ndescription: dropped bare\nvisibility: public\n---\n\nbody\n',
      { mode: 0o600 },
    )

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, 'video-downloader')
    assert.equal(entries[0]?.relativePath, 'video-downloader/SKILL.md')

    await fs.access(path.join(ref.skillsDir, 'video-downloader', 'SKILL.md'))
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'video-downloader.md')))
  })
})

test('listSkills adopts a bare SKILL.md at the skills/ root using frontmatter name when present', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    await fs.writeFile(
      path.join(ref.skillsDir, 'SKILL.md'),
      '---\nname: outline\ndescription: dropped skill\nvisibility: public\n---\n\nbody\n',
      { mode: 0o600 },
    )

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, 'outline')
    await fs.access(path.join(ref.skillsDir, 'outline', 'SKILL.md'))
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'SKILL.md')))
  })
})

test('listSkills adopts a bare nameless SKILL.md at the skills/ root under imported-skill', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    await fs.writeFile(
      path.join(ref.skillsDir, 'SKILL.md'),
      '---\ndescription: nameless drop\n---\n\nbody\n',
      { mode: 0o600 },
    )

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.name, 'imported-skill')
    await fs.access(path.join(ref.skillsDir, 'imported-skill', 'SKILL.md'))
  })
})

test('listSkills auto-writes visibility: public to a SKILL.md that lacks a visibility field', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'fresh')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
    const skillFile = path.join(skillDir, 'SKILL.md')
    await fs.writeFile(
      skillFile,
      '---\nname: fresh\ndescription: no visibility line\n---\n\nbody\n',
      { mode: 0o600 },
    )

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.visibility, 'public')

    const onDisk = await fs.readFile(skillFile, 'utf8')
    assert.match(onDisk, /visibility:\s*public/)
  })
})

test('listSkills migrates legacy visibility: discoverable to private on scan', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'legacy')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
    const skillFile = path.join(skillDir, 'SKILL.md')
    await fs.writeFile(
      skillFile,
      '---\nname: legacy\ndescription: pre-collapse\nvisibility: discoverable\n---\n\nbody\n',
      { mode: 0o600 },
    )

    const entries = await listSkills(identity)
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.visibility, 'private')

    const onDisk = await fs.readFile(skillFile, 'utf8')
    assert.match(onDisk, /visibility:\s*private/)
    assert.doesNotMatch(onDisk, /visibility:\s*discoverable/)
  })
})

test('listSkills leaves an explicit visibility untouched on scan', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'pinned')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
    const skillFile = path.join(skillDir, 'SKILL.md')
    const original = '---\nname: pinned\ndescription: pinned vis\nvisibility: public\n---\n\nbody\n'
    await fs.writeFile(skillFile, original, { mode: 0o600 })

    const entries = await listSkills(identity)
    assert.equal(entries[0]?.visibility, 'public')

    const onDisk = await fs.readFile(skillFile, 'utf8')
    assert.equal(onDisk, original)
  })
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-skills-loader-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn(home)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    invalidateSkillsCache(identity)
    await fs.rm(home, { recursive: true, force: true }).catch(() => null)
  }
}
