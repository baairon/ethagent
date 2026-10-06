import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import { runProfileCommand, type ProfileSeams } from '../../src/cli/onchain/profile.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import type { ProfileUpdates } from '../../src/identity/manager/reducer.js'
import { captureIo, type CapturedIo } from '../support/home.js'

const OWNER = getAddress('0xA1E9000000000000000000000000000000000001')
const OPERATOR = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const

function identity(state: Record<string, unknown> = {}): EthagentIdentity {
  return {
    source: 'erc8004', address: OWNER, ownerAddress: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
    chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '45744', agentUri: 'ipfs://x',
    state: { name: 'meow', description: 'a cat', ...state },
  } as EthagentIdentity
}

function deps(id: EthagentIdentity, operatorKey?: HistoryDeps['operatorKey']): HistoryDeps & { io: CapturedIo } {
  return {
    io: captureIo(),
    env: {},
    now: () => new Date(),
    loadConfig: async () => ({ version: 2, firstSeenAt: id.createdAt, identity: id } as EthagentConfig),
    listLedger: async () => [],
    ...(operatorKey ? { operatorKey } : {}),
  }
}

function seams(record: { updates?: ProfileUpdates; via?: string; saved?: EthagentConfig } = {}): ProfileSeams {
  const finish = async (step: { identity: EthagentIdentity; profileUpdates?: ProfileUpdates }, callbacks: { onIdentityComplete: (i: EthagentIdentity, m: string) => Promise<void> }) => {
    record.updates = step.profileUpdates
    await callbacks.onIdentityComplete({ ...step.identity, state: { ...(step.identity.state ?? {}), ...step.profileUpdates } }, 'Profile published.')
  }
  return {
    publishOwner: async (step, callbacks) => { record.via = 'owner'; await finish(step, callbacks) },
    publishOperator: async args => { record.via = 'operator'; await finish(args.step, args.callbacks) },
    operatorRunner: (() => (async () => { throw new Error('unused') })) as never,
    resolveJwt: async () => 'jwt',
    vaultStatus: async () => ({ ready: true }) as never,
    pullHarness: async () => [],
    imageExists: async () => true,
    openSession: async () => ({ close: async () => {} }) as never,
    openExternal: () => {},
    saveConfig: async config => { record.saved = config },
  }
}

test('profile shows the public fields read-only', async () => {
  const d = deps(identity({ imageUrl: 'ipfs://bafyimage.png' }))
  assert.equal(await runProfileCommand(['--json'], d, seams()), 0)
  const out = d.io.json()
  assert.equal(out.name, 'meow')
  assert.equal(out.image, 'ipfs://bafyimage.png')
})

test('profile edits preview a field diff and send nothing without --yes', async () => {
  const record: { via?: string } = {}
  const d = deps(identity())
  assert.equal(await runProfileCommand(['--name', 'purr', '--description', 'a cat', '--json'], d, seams(record)), 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.applied, false)
  assert.deepEqual(out.changes, [{ field: 'name', from: 'meow', to: 'purr' }])
  assert.equal(record.via, undefined)
})

test('profile --yes publishes through the owner wallet and saves the new identity', async () => {
  const record: { via?: string; updates?: ProfileUpdates; saved?: EthagentConfig } = {}
  const d = deps(identity())
  assert.equal(await runProfileCommand(['--name', 'purr', '--image', 'none', '--yes', '--json'], d, seams(record)), 0)
  assert.equal(record.via, 'owner')
  assert.deepEqual(record.updates, { name: 'purr' })
  assert.equal((record.saved?.identity?.state as Record<string, unknown>).name, 'purr')
})

test('profile with nothing changed sends nothing', async () => {
  const record: { via?: string } = {}
  const d = deps(identity())
  assert.equal(await runProfileCommand(['--name', 'meow', '--yes', '--json'], d, seams(record)), 0)
  assert.equal(d.io.json().reason, 'no-changes')
  assert.equal(record.via, undefined)
})

test('profile validates the name and the image before anything is pinned', async () => {
  const short = deps(identity())
  assert.equal(await runProfileCommand(['--name', 'x', '--json'], short, seams()), 2)
  const badType = deps(identity())
  assert.equal(await runProfileCommand(['--image', 'avatar.bmp', '--json'], badType, seams()), 2)
  const missing = deps(identity())
  assert.equal(await runProfileCommand(['--image', 'avatar.png', '--json'], missing, { ...seams(), imageExists: async () => false }), 2)
  assert.match(String(missing.io.json().error), /no file at/)
})

test('profile --operator refuses with the reasons when the operator key cannot sign', async () => {
  const d = deps(identity(), { ok: true, key: KEY, address: OPERATOR })
  assert.equal(await runProfileCommand(['--name', 'purr', '--operator', '--json'], d, seams()), 1)
  const error = String(d.io.json().error)
  assert.match(error, /custody is not advanced/)
  assert.match(error, /no ENS name is linked/)
  assert.match(error, /not an approved operator/)
})

test('profile --operator needs an injected key', async () => {
  const missing = deps(identity(), { ok: false, reason: 'missing' })
  assert.equal(await runProfileCommand(['--name', 'purr', '--operator', '--json'], missing, seams()), 3)
})

test('profile --yes needs a storage credential and exits 3 without one', async () => {
  const d = deps(identity())
  assert.equal(await runProfileCommand(['--name', 'purr', '--yes', '--json'], d, { ...seams(), resolveJwt: async () => undefined }), 3)
  assert.match(String(d.io.json().hint), /ethagent storage --set/)
})
