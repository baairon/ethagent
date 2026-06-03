import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mirrorAsSkillFolders, readManifest, type PublicSkill } from '../../../src/cli/syncAdapters/shared.js'
import { parseSkillFile } from '../../../src/identity/continuity/skills/frontmatter.js'

async function makeVaultSkill(
  vaultSkills: string,
  name: string,
  opts: { withFiles?: boolean } = {},
): Promise<PublicSkill> {
  const dir = path.join(vaultSkills, name)
  await fs.mkdir(dir, { recursive: true })
  const skillFile = path.join(dir, 'SKILL.md')
  await fs.writeFile(
    skillFile,
    `---\nname: ${name}\ndescription: ${name} desc\nvisibility: private\n---\n\nbody\n`,
  )
  if (opts.withFiles) {
    await fs.mkdir(path.join(dir, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(dir, 'scripts', 'install.mjs'), 'export const x = 1\n')
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
    await fs.writeFile(path.join(dir, 'assets', 'data.txt'), 'hello\n')
  }
  return {
    name,
    description: `${name} desc`,
    visibility: 'private',
    relativePath: `${name}/SKILL.md`,
    absolutePath: skillFile,
  }
}

test('mirrorAsSkillFolders copies the whole skill folder (scripts + assets), not just SKILL.md', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const skill = await makeVaultSkill(vault, 'sovereign-pink', { withFiles: true })

    const result = await mirrorAsSkillFolders(harness, [skill])
    assert.equal(result.count, 1)
    assert.equal(result.skipped, 0)

    await fs.access(path.join(harness, 'sovereign-pink', 'SKILL.md'))
    await fs.access(path.join(harness, 'sovereign-pink', 'scripts', 'install.mjs'))
    await fs.access(path.join(harness, 'sovereign-pink', 'assets', 'data.txt'))

    const manifest = await readManifest(harness)
    assert.deepEqual(manifest.skills, ['sovereign-pink'])
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('mirrorAsSkillFolders does not rewrite an unchanged managed skill (idempotent, no churn -> no watch loop)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const skill = await makeVaultSkill(vault, 'demo', { withFiles: true })

    await mirrorAsSkillFolders(harness, [skill])
    const mirrored = path.join(harness, 'demo', 'SKILL.md')
    const firstMtime = (await fs.stat(mirrored)).mtimeMs

    // A second identical mirror must leave the files untouched. If it rewrote them, the
    // bumped mtime would re-fire the daemon's recursive watcher and spin a sync loop.
    const result = await mirrorAsSkillFolders(harness, [skill])
    assert.equal(result.count, 1)
    assert.equal((await fs.stat(mirrored)).mtimeMs, firstMtime)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('a skill containing a Windows reserved-name file (nul.md) still mirrors (file skipped, not aborted)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const skill = await makeVaultSkill(vault, 'demo', { withFiles: true })
    await fs.writeFile(path.join(vault, 'demo', 'nul.md'), 'reserved device name\n')

    const result = await mirrorAsSkillFolders(harness, [skill])
    assert.equal(result.count, 1) // the skill mirrors; the reserved file does not abort it
    await fs.access(path.join(harness, 'demo', 'SKILL.md'))
    await assert.rejects(fs.access(path.join(harness, 'demo', 'nul.md'))) // reserved-name file skipped
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('mirrorAsSkillFolders rewrites SKILL.md frontmatter as strict-valid YAML (Codex-safe)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    const dir = path.join(vault, 'vscode-setup')
    await fs.mkdir(dir, { recursive: true })
    const description = 'Set it up in one shot: apply my "Dark" theme'
    // Lenient (Claude-tolerated) frontmatter: an unquoted colon + quotes a strict parser rejects.
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      `---\nname: vscode-setup\ndescription: ${description}\nvisibility: public\n---\n\nbody\n`,
    )
    const skill: PublicSkill = {
      name: 'vscode-setup',
      description,
      visibility: 'public',
      relativePath: 'vscode-setup/SKILL.md',
      absolutePath: path.join(dir, 'SKILL.md'),
    }

    await mirrorAsSkillFolders(harness, [skill])

    const mirrored = await fs.readFile(path.join(harness, 'vscode-setup', 'SKILL.md'), 'utf8')
    assert.match(mirrored, /description: "/) // now a quoted YAML scalar
    assert.equal(parseSkillFile(mirrored).frontmatter.description, description) // round-trips
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('mirrorAsSkillFolders leaves an existing unmanaged folder untouched and reports it skipped', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const skill = await makeVaultSkill(vault, 'manual')
    await fs.mkdir(path.join(harness, 'manual'), { recursive: true })
    await fs.writeFile(path.join(harness, 'manual', 'SKILL.md'), 'hand written\n')

    const result = await mirrorAsSkillFolders(harness, [skill])
    assert.equal(result.skipped, 1)
    assert.equal(result.count, 0)
    const body = await fs.readFile(path.join(harness, 'manual', 'SKILL.md'), 'utf8')
    assert.equal(body, 'hand written\n')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('mirrorAsSkillFolders refreshes a managed skill in place, dropping files removed upstream', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const skill = await makeVaultSkill(vault, 'demo', { withFiles: true })

    await mirrorAsSkillFolders(harness, [skill])
    await fs.access(path.join(harness, 'demo', 'scripts', 'install.mjs'))

    await fs.rm(path.join(vault, 'demo', 'scripts', 'install.mjs'))
    await fs.writeFile(path.join(vault, 'demo', 'scripts', 'run.mjs'), 'export const y = 2\n')

    await mirrorAsSkillFolders(harness, [skill])
    await fs.access(path.join(harness, 'demo', 'scripts', 'run.mjs'))
    await assert.rejects(fs.access(path.join(harness, 'demo', 'scripts', 'install.mjs')))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('mirrorAsSkillFolders skips dotfiles when copying the skill folder', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const skill = await makeVaultSkill(vault, 'demo', { withFiles: true })
    await fs.writeFile(path.join(vault, 'demo', '.secret'), 'should not be mirrored\n')

    await mirrorAsSkillFolders(harness, [skill])
    await fs.access(path.join(harness, 'demo', 'SKILL.md'))
    await assert.rejects(fs.access(path.join(harness, 'demo', '.secret')))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})

test('mirrorAsSkillFolders removes managed skills that are no longer present upstream', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mirror-'))
  try {
    const vault = path.join(tmp, 'vault')
    const harness = path.join(tmp, 'harness')
    await fs.mkdir(vault, { recursive: true })
    const keep = await makeVaultSkill(vault, 'keep')
    const drop = await makeVaultSkill(vault, 'drop')

    await mirrorAsSkillFolders(harness, [keep, drop])
    await fs.access(path.join(harness, 'drop', 'SKILL.md'))

    const result = await mirrorAsSkillFolders(harness, [keep])
    assert.equal(result.count, 1)
    await fs.access(path.join(harness, 'keep', 'SKILL.md'))
    await assert.rejects(fs.access(path.join(harness, 'drop')))
    const manifest = await readManifest(harness)
    assert.deepEqual(manifest.skills, ['keep'])
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => null)
  }
})
