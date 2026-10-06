import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getAddress } from 'viem'
import { runCheckCommand, type CheckSeams } from '../../src/cli/onchain/check.js'
import { runSkillsCommand } from '../../src/cli/history/skills.js'
import { runHistoryCommand } from '../../src/cli/history/index.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import type { AgentReconciliation } from '../../src/identity/manager/shared/reconciliation/agentReconciliation/types.js'
import { continuityVaultRef } from '../../src/identity/continuity/storage/paths.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import { captureIo, withHome, type CapturedIo } from '../support/home.js'

const OWNER = getAddress('0xA1E9000000000000000000000000000000000001')
const VAULT = getAddress('0x6bdC0000000000000000000000000000000051d7')
const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const CID = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'

function identity(extra: Partial<EthagentIdentity> = {}, state: Record<string, unknown> = {}): EthagentIdentity {
  return {
    source: 'erc8004', address: OWNER, ownerAddress: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
    chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY,
    agentId: '45744', agentUri: `ipfs://${CID}`, metadataCid: CID,
    state: { name: 'meow', description: 'test agent', ensName: 'meow.example.eth', custodyMode: 'simple', ...state },
    backup: { cid: 'bafysnapshot', createdAt: '2026-02-01T00:00:00.000Z', envelopeVersion: '1', ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files', status: 'pinned', metadataCid: CID },
    agentCard: { cid: 'bafycard' },
    ...extra,
  } as EthagentIdentity
}

function deps(id: EthagentIdentity | null, env: NodeJS.ProcessEnv = {}): HistoryDeps & { io: CapturedIo } {
  return {
    io: captureIo(),
    env,
    now: () => new Date('2026-03-01T00:00:00.000Z'),
    loadConfig: async () => (id ? { version: 2, firstSeenAt: id.createdAt, identity: id } as EthagentConfig : null),
    listLedger: async () => [],
  }
}

function recon(overrides: Partial<AgentReconciliation> = {}): AgentReconciliation {
  return {
    token: 'linked', onChainOwner: OWNER, custody: 'simple', agentUri: 'in-sync', vault: 'unset',
    workingTree: 'clean', rpc: 'reachable', driftCount: 0, lastCheckedAt: '', ...overrides,
  }
}

function checkSeams(r: AgentReconciliation, changed: string[] | null = [], seen: { rpcUrl?: string } = {}): CheckSeams {
  return {
    reconcile: async id => { seen.rpcUrl = id.rpcUrl; return r },
    localChanges: async () => changed,
  }
}

// --- check ------------------------------------------------------------------------

test('check lists every token value and exits 0 when nothing needs attention', async () => {
  const d = deps(identity())
  assert.equal(await runCheckCommand(['--json'], d, checkSeams(recon())), 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.values.agentId, '45744')
  assert.equal(out.values.network, 'base')
  assert.equal(out.values.registry, REGISTRY)
  assert.equal(out.values.owner, OWNER)
  assert.equal(out.values.agentUri, `ipfs://${CID}`)
  assert.equal(out.values.snapshotCid, 'bafysnapshot')
  assert.equal(out.values.metadataCid, CID)
  assert.equal(out.values.agentCardCid, 'bafycard')
  assert.equal(out.values.ensName, 'meow.example.eth')
  assert.equal(out.values.custody, 'simple')
  assert.equal(out.values.pendingPublish, false)
  assert.equal(out.values.transfer, null)
  assert.deepEqual(out.attention, [])
  const text = deps(identity())
  assert.equal(await runCheckCommand([], text, checkSeams(recon())), 0)
  assert.match(text.io.stdout(), /Nothing needs attention/)
})

test('check names the fix for each thing that needs attention and exits 4', async () => {
  const pending = identity({ backup: { ...identity().backup!, metadataCid: 'bafyold' } }, { custodyMode: 'advanced', operatorVaultAddress: VAULT })
  const pendingTx = { hash: '0xabc', kind: 'vault-deposit' as const, chainId: 8453, submittedAt: '2026-02-02T00:00:00.000Z' }
  const d = deps({ ...pending, pendingTx })
  assert.equal(await runCheckCommand(['--json'], d, checkSeams(recon({ agentUri: 'local-newer', vault: 'unrecognized' }), ['MEMORY.md'])), 4)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.values.vault, VAULT)
  assert.equal(out.values.pendingPublish, true)
  const byCode = Object.fromEntries((out.attention as Array<{ code: string; fix?: string }>).map(item => [item.code, item.fix]))
  assert.equal(byCode['publish-pending'], 'ethagent save')
  assert.equal(byCode['vault-unrecognized'], 'ethagent custody --verify')
  assert.equal(byCode['local-changes'], 'ethagent save')
  assert.ok('transaction-unconfirmed' in byCode)
})

test('check reports an unfinished custody switch and a token that left the wallet', async () => {
  const d = deps(identity())
  assert.equal(await runCheckCommand(['--json'], d, checkSeams(recon({ custody: 'mid-flow-uri-pending', agentUri: 'local-newer', token: 'unlinked', tokenAgentId: '45744', onChainOwner: VAULT }))), 4)
  const attention = d.io.json().attention as Array<{ code: string; fix?: string }>
  assert.deepEqual(attention.map(item => item.code), ['token-unlinked', 'custody-unfinished'])
  assert.equal(attention[1]!.fix, 'ethagent custody --advanced')
})

test('check reads through ETHAGENT_RPC_URL and refuses without an agent', async () => {
  const seen: { rpcUrl?: string } = {}
  const d = deps(identity(), { ETHAGENT_RPC_URL: 'https://rpc.example.invalid' })
  assert.equal(await runCheckCommand(['--json'], d, checkSeams(recon(), [], seen)), 0)
  assert.equal(seen.rpcUrl, 'https://rpc.example.invalid')
  const none = deps(null)
  assert.equal(await runCheckCommand(['--json'], none, checkSeams(recon())), 1)
  assert.match(String(none.io.json().hint), /ethagent create/)
  const extra = deps(identity())
  assert.equal(await runCheckCommand(['extra', '--json'], extra, checkSeams(recon())), 2)
})

// --- skills -----------------------------------------------------------------------

async function seedSkills(id: EthagentIdentity): Promise<string> {
  const ref = continuityVaultRef(id)
  await fs.mkdir(path.join(ref.skillsDir, 'alpha', 'scripts'), { recursive: true })
  await fs.mkdir(path.join(ref.skillsDir, 'draft'), { recursive: true })
  await fs.writeFile(ref.soulPath, '# SOUL.md\n')
  await fs.writeFile(ref.memoryPath, '# MEMORY.md\n')
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Summarizes release notes.\nvisibility: private\n---\nbody\n')
  await fs.writeFile(path.join(ref.skillsDir, 'alpha', 'scripts', 'run.py'), 'print(1)\n')
  await fs.writeFile(path.join(ref.skillsDir, 'draft', 'SKILL.md'), '---\nname: draft\ndescription: <what it does>\nvisibility: public\n---\nbody\n')
  return ref.skillsDir
}

const ready = { vaultReady: async () => true, checkpoint: undefined as never }

test('skills lists visibility and what the Agent Card publishes, leaving drafts off', async () => {
  await withHome(async () => {
    const id = identity()
    await seedSkills(id)
    const d = deps(id)
    assert.equal(await runSkillsCommand(['--json'], d), 0, d.io.stdout())
    const skills = d.io.json().skills as Array<Record<string, unknown>>
    assert.deepEqual(skills.map(skill => [skill.name, skill.visibility, skill.onAgentCard, skill.draft]), [
      ['alpha', 'private', false, false],
      ['draft', 'public', false, true],
    ])
  })
})

test('skills --public and --private rewrite the frontmatter and the agent card', async () => {
  await withHome(async () => {
    const id = identity()
    const skillsDir = await seedSkills(id)
    const pub = deps(id)
    assert.equal(await runSkillsCommand(['--public', 'alpha', '--json'], pub), 0, pub.io.stdout())
    assert.equal(pub.io.json().onAgentCard, true)
    assert.match(await fs.readFile(path.join(skillsDir, 'alpha', 'SKILL.md'), 'utf8'), /visibility: public/)
    assert.match(await fs.readFile(continuityVaultRef(id).agentCardPath, 'utf8'), /Summarizes release notes/)
    const again = deps(id)
    assert.equal(await runSkillsCommand(['--public', 'alpha', '--json'], again), 0)
    assert.equal(again.io.json().applied, false)
    const priv = deps(id)
    assert.equal(await runSkillsCommand(['--private', 'alpha/', '--json'], priv), 0)
    assert.doesNotMatch(await fs.readFile(continuityVaultRef(id).agentCardPath, 'utf8'), /Summarizes release notes/)
  })
})

test('skills --delete previews, then checkpoints, deletes, and the named rollback brings it back', async () => {
  await withHome(async () => {
    const id = identity()
    const skillsDir = await seedSkills(id)
    const preview = deps(id)
    assert.equal(await runSkillsCommand(['--delete', 'alpha', '--json'], preview), 0)
    assert.equal(preview.io.json().applied, false)
    await fs.access(path.join(skillsDir, 'alpha', 'SKILL.md'))
    const run = deps(id)
    assert.equal(await runSkillsCommand(['--delete', 'alpha', '--yes', '--json'], run), 0, run.io.stdout())
    const undo = String(run.io.json().undo)
    assert.match(undo, /^ethagent rollback cp:\S+ --yes$/)
    await assert.rejects(fs.access(path.join(skillsDir, 'alpha')))
    const back = deps(id)
    assert.equal(await runHistoryCommand('rollback', [undo.split(' ')[2]!, '--yes', '--json'], back), 0, back.io.stdout())
    assert.equal(await fs.readFile(path.join(skillsDir, 'alpha', 'scripts', 'run.py'), 'utf8'), 'print(1)\n')
  })
})

test('skills refuses unknown names, mixed flags, a stray --yes, and an unrestored vault', async () => {
  await withHome(async () => {
    const id = identity()
    await seedSkills(id)
    const unknown = deps(id)
    assert.equal(await runSkillsCommand(['--public', 'nope', '--json'], unknown), 1)
    assert.match(String(unknown.io.json().hint), /alpha, draft/)
    const both = deps(id)
    assert.equal(await runSkillsCommand(['--public', 'alpha', '--delete', 'alpha', '--json'], both), 2)
    const yes = deps(id)
    assert.equal(await runSkillsCommand(['--public', 'alpha', '--yes', '--json'], yes), 2)
    const notReady = deps(id)
    assert.equal(await runSkillsCommand(['--json'], notReady, { ...ready, vaultReady: async () => false }), 1)
    assert.match(String(notReady.io.json().hint), /ethagent restore/)
  })
})
