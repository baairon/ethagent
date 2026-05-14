import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listSkillFilesTool } from '../../src/tools/listSkillFilesTool.js'
import {
  continuityVaultRef,
  ensureContinuityVault,
} from '../../src/identity/continuity/storage.js'
import { invalidateSkillsCache } from '../../src/identity/continuity/skills/loadSkills.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'

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

const config = {
  version: 1,
  provider: 'anthropic',
  model: 'claude-test',
  firstRunAt: new Date(0).toISOString(),
  identity,
} as unknown as EthagentConfig

test('list_private_skill_files emits relative size and absolute path per file', async () => {
  await withHome(async home => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'video-downloader')
    const refsDir = path.join(skillDir, 'references')
    await fs.mkdir(refsDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\ndescription: dl wrapper\nvisibility: private\n---\n\nbody\n',
      { mode: 0o600 },
    )
    await fs.writeFile(path.join(skillDir, 'download.py'), 'print("hi")\n', { mode: 0o600 })
    await fs.writeFile(path.join(refsDir, 'usage.md'), '# usage\n', { mode: 0o600 })

    const result = await listSkillFilesTool.execute(
      { name: 'video-downloader' },
      { workspaceRoot: home, config },
    )

    assert.equal(result.ok, true)
    const content = result.content
    const lines = content.split('\n')
    assert.equal(lines.length, 3)
    const downloadLine = lines.find(l => l.startsWith('- download.py'))
    assert.ok(downloadLine, 'expected line for download.py')
    assert.match(downloadLine!, /^- download\.py \(\d+ bytes\) — /)
    const dashIdx = downloadLine!.lastIndexOf(' — ')
    const absolutePath = downloadLine!.slice(dashIdx + 3)
    assert.equal(absolutePath, path.join(skillDir, 'download.py'))

    const referencesLine = lines.find(l => l.startsWith('- references/usage.md'))
    assert.ok(referencesLine, 'expected line for references/usage.md')
    assert.ok(referencesLine!.endsWith(path.join(skillDir, 'references', 'usage.md')))
  })
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-list-skill-files-'))
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
