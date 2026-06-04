import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  invalidateSkillsCache,
  setSkillVisibility,
} from '../../../src/identity/continuity/skills/loadSkills.js'
import {
  derivePublicSkillEntries,
  renderAgentCardJsonForIdentity,
} from '../../../src/identity/continuity/skills/publicSkillsSync.js'
import { ensureContinuityVault } from '../../../src/identity/continuity/storage.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  chainId: 1,
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
  agentId: '77',
  state: { name: 'card test' },
}

test('private skills are excluded from the Agent Card; public skills appear; flipping visibility updates it', async () => {
  await withHome(async () => {
    await ensureContinuityVault(identity)
    invalidateSkillsCache(identity)
    await writeSkill('classified', '---\nname: classified\ndescription: a real private skill\nvisibility: private\n---\n\nbody\n')
    await writeSkill('shared', '---\nname: shared\ndescription: a real public skill\nvisibility: public\n---\n\nbody\n')
    invalidateSkillsCache(identity)

    const pub = await derivePublicSkillEntries(identity)
    assert.deepEqual(pub.map(e => e.name).sort(), ['shared'])

    const card = await renderAgentCardJsonForIdentity(identity)
    assert.match(card, /shared/)
    assert.doesNotMatch(card, /classified/)

    await setSkillVisibility(identity, 'classified/SKILL.md', 'public')
    invalidateSkillsCache(identity)

    const pub2 = await derivePublicSkillEntries(identity)
    assert.deepEqual(pub2.map(e => e.name).sort(), ['classified', 'shared'])
    const card2 = await renderAgentCardJsonForIdentity(identity)
    assert.match(card2, /classified/)
  })
})

async function writeSkill(name: string, body: string): Promise<void> {
  const ref = await ensureContinuityVault(identity)
  const skillDir = path.join(ref.skillsDir, name)
  await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), body, { mode: 0o600 })
  invalidateSkillsCache(identity)
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-public-skills-sync-'))
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
