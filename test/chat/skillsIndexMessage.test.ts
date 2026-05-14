import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildSkillsIndexMessage } from '../../src/chat/chatTurnOrchestrator.js'
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

test('buildSkillsIndexMessage annotates skills with supporting file counts', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const onlySkillDir = path.join(ref.skillsDir, 'plain-skill')
    const withExtrasDir = path.join(ref.skillsDir, 'video-downloader')
    const extrasReferencesDir = path.join(withExtrasDir, 'references')
    await fs.mkdir(onlySkillDir, { recursive: true, mode: 0o700 })
    await fs.mkdir(extrasReferencesDir, { recursive: true, mode: 0o700 })

    await fs.writeFile(
      path.join(onlySkillDir, 'SKILL.md'),
      '---\ndescription: plain skill body\nvisibility: private\n---\n\nbody\n',
      { mode: 0o600 },
    )
    await fs.writeFile(
      path.join(withExtrasDir, 'SKILL.md'),
      '---\ndescription: yt-dlp wrapper\nvisibility: private\n---\n\nbody\n',
      { mode: 0o600 },
    )
    await fs.writeFile(path.join(withExtrasDir, 'download.py'), '# download\n', { mode: 0o600 })
    await fs.writeFile(path.join(extrasReferencesDir, 'usage.md'), '# usage\n', { mode: 0o600 })

    const messages = await buildSkillsIndexMessage(config)
    assert.equal(messages.length, 1)
    const content = messages[0]?.content
    assert.equal(typeof content, 'string')
    const body = content as string

    assert.match(body, /- video-downloader — yt-dlp wrapper \(\+2 supporting files\)/)
    assert.match(body, /- plain-skill — plain skill body(?!.*supporting file)/)
    assert.doesNotMatch(body.split('\n').find(l => l.startsWith('- plain-skill')) ?? '', /supporting file/)
    assert.match(body, /list_private_skill_files/)
    assert.match(body, /run_bash/)
    assert.match(body, /absolute path/)
  })
})

test('buildSkillsIndexMessage uses singular "supporting file" when count is one', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    const ref = continuityVaultRef(identity)
    const dir = path.join(ref.skillsDir, 'solo-extra')
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '---\ndescription: one extra\nvisibility: private\n---\n\nbody\n',
      { mode: 0o600 },
    )
    await fs.writeFile(path.join(dir, 'helper.md'), '# helper\n', { mode: 0o600 })

    const messages = await buildSkillsIndexMessage(config)
    const body = messages[0]?.content as string
    assert.match(body, /- solo-extra — one extra \(\+1 supporting file\)(?!s)/)
  })
})

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-skills-index-'))
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
