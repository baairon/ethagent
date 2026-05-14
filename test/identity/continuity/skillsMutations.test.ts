import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createSkillFile,
  deleteSkillEntry,
  invalidateSkillsCache,
  isValidSkillEntryKey,
  isValidSkillFilePath,
  listSkills,
  listSkillFiles,
  listSkillsTree,
  materializeSkillsTree,
  loadSkillsTree,
  setSkillVisibility,
} from '../../../src/identity/continuity/skills/loadSkills.js'
import { defaultSkillScaffold, isDraftScaffold } from '../../../src/identity/continuity/skills/scaffold.js'
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
  agentId: '99',
  state: { name: 'mutation test' },
}

test('createSkillFile writes a Claude-style flat folder with the rich scaffold', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    const created = await createSkillFile(identity, { name: 'obit' })
    assert.equal(created.relativePath, 'obit/SKILL.md')
    assert.equal(created.displayName, 'obit')

    const ref = continuityVaultRef(identity)
    const skillPath = path.join(ref.skillsDir, 'obit', 'SKILL.md')
    const body = await fs.readFile(skillPath, 'utf8')
    assert.match(body, /^---\n/)
    assert.match(body, /name: obit/)
    assert.match(body, /# Overview/)
    assert.match(body, /# Instructions/)
    assert.match(body, /# Examples/)
    assert.match(body, /# Notes/)
    assert.match(body, /visibility: discoverable/)

    const tree = await listSkillsTree(identity)
    assert.equal(tree.skills.length, 1)
    assert.equal(tree.skills[0]?.name, 'obit')
    assert.equal(tree.skills[0]?.relativePath, 'obit/SKILL.md')
  })
})

test('deleteSkillEntry removes the skill folder and all supporting files', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    await createSkillFile(identity, { name: 'obit' })
    const ref = continuityVaultRef(identity)
    const referencesDir = path.join(ref.skillsDir, 'obit', 'references')
    await fs.mkdir(referencesDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(referencesDir, 'api.md'), '# api\n', { mode: 0o600 })
    invalidateSkillsCache(identity)

    await deleteSkillEntry(identity, 'obit/SKILL.md')
    await assert.rejects(fs.access(path.join(ref.skillsDir, 'obit')))

    const tree = await listSkillsTree(identity)
    assert.deepEqual(tree.skills, [])
  })
})

test('createSkillFile rejects duplicate folder names', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    await createSkillFile(identity, { name: 'obit' })
    await assert.rejects(
      () => createSkillFile(identity, { name: 'obit' }),
      /already exists/,
    )
  })
})

test('createSkillFile rejects path-traversal segments', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    await assert.rejects(() => createSkillFile(identity, { name: '..' }))
    await assert.rejects(() => createSkillFile(identity, { name: 'with/slash' }))
    await assert.rejects(() => createSkillFile(identity, { name: 'with space' }))
  })
})

test('isValidSkillEntryKey enforces flat <name>/SKILL.md shape', () => {
  assert.equal(isValidSkillEntryKey('obit/SKILL.md'), true)
  assert.equal(isValidSkillEntryKey('writing-obit/SKILL.md'), true)
  assert.equal(isValidSkillEntryKey('writing/obit/SKILL.md'), false)
  assert.equal(isValidSkillEntryKey('obit/skill.md'), false)
  assert.equal(isValidSkillEntryKey('obit.md'), false)
  assert.equal(isValidSkillEntryKey('SKILL.md'), false)
  assert.equal(isValidSkillEntryKey('../obit/SKILL.md'), false)
  assert.equal(isValidSkillEntryKey('/obit/SKILL.md'), false)
  assert.equal(isValidSkillEntryKey('C:/obit/SKILL.md'), false)
  assert.equal(isValidSkillEntryKey(''), false)
})

test('isValidSkillFilePath accepts supporting files at any nesting up to MAX_FOLDER_DEPTH', () => {
  assert.equal(isValidSkillFilePath('obit/SKILL.md'), true)
  assert.equal(isValidSkillFilePath('obit/references/api.md'), true)
  assert.equal(isValidSkillFilePath('obit/scripts/extract.py'), true)
  assert.equal(isValidSkillFilePath('obit/examples/sample.md'), true)
  assert.equal(isValidSkillFilePath('../escape/file.md'), false)
  assert.equal(isValidSkillFilePath('/obit/file.md'), false)
  assert.equal(isValidSkillFilePath('obit/'), false)
  assert.equal(isValidSkillFilePath('obit/folder-without-extension'), false)
})

test('materializeSkillsTree writes the canonical layout including supporting files', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    await materializeSkillsTree(identity, {
      'obit/SKILL.md': '---\nname: obit\nvisibility: private\n---\n\nbody one\n',
      'obit/references/api.md': '# api notes\n',
      'commit/SKILL.md': '---\nname: commit\nvisibility: public\n---\n\nbody two\n',
    })

    const entries = await listSkills(identity)
    const names = entries.map(e => e.name).sort()
    assert.deepEqual(names, ['commit', 'obit'])

    const obitFiles = await listSkillFiles(identity, 'obit')
    const rels = obitFiles.map(f => f.relativePath).sort()
    assert.deepEqual(rels, ['SKILL.md', 'references/api.md'])
  })
})

test('loadSkillsTree round-trips both SKILL.md and supporting files', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    const body = defaultSkillScaffold({ name: 'obit' })
    await materializeSkillsTree(identity, {
      'obit/SKILL.md': body,
      'obit/references/api.md': '# api\n',
    })
    const tree = await loadSkillsTree(identity)
    const keys = Object.keys(tree).sort()
    assert.deepEqual(keys, ['obit/SKILL.md', 'obit/references/api.md'])
    assert.equal(tree['obit/SKILL.md'], body)
    assert.equal(tree['obit/references/api.md'], '# api\n')
  })
})

test('normalizeContinuitySkills upgrades legacy <category>/<name>.md envelope keys to flat shape', async () => {
  const { normalizeContinuitySkills } = await import('../../../src/identity/continuity/envelope.js')
  const upgraded = normalizeContinuitySkills({
    'writing/obit.md': '---\nname: writing-obit\n---\n\nbody\n',
  })
  assert.deepEqual(upgraded, {
    'writing-obit/SKILL.md': '---\nname: writing-obit\n---\n\nbody\n',
  })
})

test('normalizeContinuitySkills upgrades legacy nested <category>/<skill>/<file> envelope keys', async () => {
  const { normalizeContinuitySkills } = await import('../../../src/identity/continuity/envelope.js')
  const upgraded = normalizeContinuitySkills({
    'writing/obit/SKILL.md': '---\nname: writing-obit\n---\n\nbody\n',
    'writing/obit/references/api.md': '# api\n',
  })
  assert.deepEqual(upgraded, {
    'writing-obit/SKILL.md': '---\nname: writing-obit\n---\n\nbody\n',
    'writing-obit/references/api.md': '# api\n',
  })
})

test('normalizeContinuitySkills: canonical flat key always wins over colliding legacy entry', async () => {
  const { normalizeContinuitySkills } = await import('../../../src/identity/continuity/envelope.js')
  const canonical = 'canonical body\n'
  const legacy = 'legacy body\n'
  const legacyFirst = normalizeContinuitySkills({
    'writing/obit.md': legacy,
    'writing-obit/SKILL.md': canonical,
  })
  assert.deepEqual(legacyFirst, { 'writing-obit/SKILL.md': canonical })

  const canonicalFirst = normalizeContinuitySkills({
    'writing-obit/SKILL.md': canonical,
    'writing/obit.md': legacy,
  })
  assert.deepEqual(canonicalFirst, { 'writing-obit/SKILL.md': canonical })
})

test('setSkillVisibility flips frontmatter and preserves body', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    await createSkillFile(identity, { name: 'obit' })
    const ref = continuityVaultRef(identity)
    const file = path.join(ref.skillsDir, 'obit', 'SKILL.md')

    const before = await fs.readFile(file, 'utf8')
    assert.match(before, /visibility: discoverable/)

    await setSkillVisibility(identity, 'obit/SKILL.md', 'public')
    const afterPublic = await fs.readFile(file, 'utf8')
    assert.match(afterPublic, /visibility: public/)
    assert.match(afterPublic, /# Overview/)
    assert.doesNotMatch(afterPublic, /visibility: discoverable/)

    await setSkillVisibility(identity, 'obit/SKILL.md', 'discoverable')
    const afterDiscoverable = await fs.readFile(file, 'utf8')
    assert.match(afterDiscoverable, /visibility: discoverable/)
  })
})

test('setSkillVisibility adds visibility line when missing', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'obit')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: obit\n---\n\nbody\n', { mode: 0o600 })

    invalidateSkillsCache(identity)
    await setSkillVisibility(identity, 'obit/SKILL.md', 'public')
    const after = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
    assert.match(after, /visibility: public/)
    assert.match(after, /name: obit/)
    assert.match(after, /body/)
  })
})

test('createSkillFile defaults to visibility: discoverable when no visibility is passed', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    const created = await createSkillFile(identity, { name: 'default-vis' })
    const body = await fs.readFile(created.absolutePath, 'utf8')
    assert.match(body, /visibility: discoverable/)
  })
})

test('createSkillFile honors explicit visibility: public', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    const created = await createSkillFile(identity, { name: 'public-skill', visibility: 'public' })
    const body = await fs.readFile(created.absolutePath, 'utf8')
    assert.match(body, /visibility: public/)
    assert.doesNotMatch(body, /visibility: discoverable/)
  })
})

test('createSkillFile honors explicit visibility: private', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    const created = await createSkillFile(identity, { name: 'private-skill', visibility: 'private' })
    const body = await fs.readFile(created.absolutePath, 'utf8')
    assert.match(body, /visibility: private/)
    assert.doesNotMatch(body, /visibility: discoverable/)
  })
})

test('isDraftScaffold detects empty, placeholder, and self-named descriptions', () => {
  assert.equal(isDraftScaffold({ description: '', name: 'obit' }), true)
  assert.equal(isDraftScaffold({ description: '<placeholder>', name: 'obit' }), true)
  assert.equal(isDraftScaffold({ description: 'obit', name: 'obit' }), true)
  assert.equal(isDraftScaffold({ description: 'Draft eulogies for a given person', name: 'obit' }), false)
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-skills-mutations-'))
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
