import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readSkillTool } from '../../src/tools/readSkillTool.js'
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

test('read_private_skill emits absolute path for supporting files', async () => {
  await withHome(async home => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const skillDir = path.join(ref.skillsDir, 'video-downloader')
    await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\ndescription: dl wrapper\nvisibility: private\n---\n\nbody\n',
      { mode: 0o600 },
    )
    await fs.writeFile(path.join(skillDir, 'download.py'), 'print("hi")\n', { mode: 0o600 })

    const result = await readSkillTool.execute(
      { name: 'video-downloader', file: 'download.py' },
      { workspaceRoot: home, config },
    )

    assert.equal(result.ok, true)
    const expectedAbsolute = path.join(skillDir, 'download.py')
    assert.ok(
      result.content.startsWith(
        `<private_skill_file name="video-downloader" file="download.py" path="${expectedAbsolute}">`,
      ),
      `wrapper missing absolute path attribute: ${result.content.split('\n')[0]}`,
    )
    assert.ok(result.content.includes('print("hi")'))
    assert.ok(result.content.trimEnd().endsWith('</private_skill_file>'))
  })
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-read-skill-'))
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
