import test from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { createWalletRestoreAccessChallenge } from '../../../src/identity/continuity/challenges.js'
import {
  createContinuitySnapshotEnvelope,
  createContinuitySnapshotChallenge,
  serializeContinuitySnapshotEnvelope,
} from '../../../src/identity/continuity/envelope.js'
import { createContinuityEnvelopeForSave } from '../../../src/identity/manager/continuity/snapshot.js'
import { generatePrivateKey, signMessage } from '../../../src/identity/crypto/eth.js'
import {
  decryptWithSigner,
  localKeySigner,
  signatureVariants,
} from '../../../src/identity/continuity/localKeyDecrypt.js'
import { fetchSnapshotIntoStore } from '../../../src/identity/continuity/snapshotFetch.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readEntryBytes, readSnapshotManifest, snapshotStoreDir } from '../../../src/identity/continuity/snapshotStore.js'
import { buildEnvelopeFixtures, ENVELOPE_REGISTRY } from '../manager/effects/effects.fixtures.js'
import { fakeFetch, rawCid, withHome } from '../../support/home.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'

const FILES = { 'SOUL.md': '# SOUL.md\r\n- Voice: calm\r\n', 'MEMORY.md': '# MEMORY.md\n- Fact: one' }
const SKILLS = { 'alpha/SKILL.md': '---\nvisibility: private\n---\nalpha\n', 'alpha/scripts/run.py': 'print(1)\n' }

function ownerSignedEnvelope(f: ReturnType<typeof buildEnvelopeFixtures>) {
  const identity = { address: f.ownerAddress, ownerAddress: f.ownerAddress, agentId: f.token.agentId, state: structuredClone(f.baseState) } as unknown as EthagentIdentity
  const challenge = createWalletRestoreAccessChallenge({ token: f.token, ownerAddress: f.ownerAddress, walletAddress: f.ownerAddress, accessEpoch: f.accessEpoch, purpose: 'restore-owner' })
  return createContinuityEnvelopeForSave({
    identity,
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.ownerAddress,
    walletSignature: signMessage(f.ownerKey, challenge),
    state: structuredClone(f.baseState),
    files: FILES,
    skills: SKILLS,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'restore-owner',
  })
}

test('the operator key opens an owner-signed snapshot through its own slot', async () => {
  const f = buildEnvelopeFixtures()
  const result = await decryptWithSigner(ownerSignedEnvelope(f), localKeySigner(f.operatorKey))
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.payload.files, FILES)
    assert.deepEqual(result.payload.skills, SKILLS)
  }
})

test('a key without a slot is reported as locked, not as an error', async () => {
  const f = buildEnvelopeFixtures()
  const result = await decryptWithSigner(ownerSignedEnvelope(f), localKeySigner(generatePrivateKey()))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'no-slot')
    assert.ok(result.slots?.includes(f.operatorAddress))
  }
})

test('owner-signature envelopes open only for the owner', async () => {
  const ownerKey = generatePrivateKey()
  const owner = privateKeyToAccount(ownerKey as `0x${string}`).address
  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress: owner,
    walletSignature: signMessage(ownerKey, createContinuitySnapshotChallenge(owner)),
    payload: { agent: {}, files: FILES, transcript: [], state: {} },
  })
  const stranger = await decryptWithSigner(envelope, localKeySigner(generatePrivateKey()))
  assert.equal(stranger.ok ? 'ok' : stranger.reason, 'owner-only')
  const opened = await decryptWithSigner(envelope, localKeySigner(ownerKey))
  assert.equal(opened.ok, true)
})

test('signature variants toggle v between 27/28 and 0/1 so wallet-made slots still open', async () => {
  const f = buildEnvelopeFixtures()
  const envelope = ownerSignedEnvelope(f)
  const signer = localKeySigner(f.operatorKey)
  const flipped = { address: signer.address, sign: async (challenge: string) => signatureVariants(await signer.sign(challenge))[1]! }
  const result = await decryptWithSigner(envelope, flipped)
  assert.equal(result.ok, true)
})

test('the local signer matches viem byte for byte', async () => {
  const key = generatePrivateKey()
  const account = privateKeyToAccount(key as `0x${string}`)
  for (const message of ['hello', 'Restore Agent\nAccess Epoch: 3', '']) {
    assert.equal(signMessage(key, message), await account.signMessage({ message }))
  }
})

test('fetch caches a decrypted snapshot with its agent card, and reports locked ones', async () => {
  await withHome(async () => {
    const f = buildEnvelopeFixtures()
    const envelopeBytes = Buffer.from(serializeContinuitySnapshotEnvelope(ownerSignedEnvelope(f)), 'utf8')
    const cardBytes = Buffer.from('{\n  "name": "agent"\n}\n', 'utf8')
    const cid = rawCid(envelopeBytes)
    const cardCid = rawCid(cardBytes)
    const fetchImpl = fakeFetch(new Map([[cid, envelopeBytes], [cardCid, cardBytes]]))
    const identity = { address: f.ownerAddress, chainId: 1, identityRegistryAddress: ENVELOPE_REGISTRY.identityRegistryAddress, agentId: '42' } as EthagentIdentity
    const entry = { cid, agentCardCid: cardCid, createdAt: '2026-01-01T00:00:00.000Z' }
    const deps = { apiUrl: 'https://uploads.pinata.cloud/v3/files', fetchImpl, retries: 0 }
    const first = await fetchSnapshotIntoStore(identity, entry, { ...deps, signer: localKeySigner(f.operatorKey) })
    assert.equal(first.status, 'cached')
    const again = await fetchSnapshotIntoStore(identity, entry, { ...deps, signer: localKeySigner(f.operatorKey) })
    assert.equal(again.status, 'already-cached')
    const manifest = await readSnapshotManifest(identity, cid)
    assert.equal(manifest?.kind, 'snapshot')
    if (manifest?.kind === 'snapshot') {
      const read = await readEntryBytes(identity, manifest.files)
      assert.equal(Buffer.from(read.files['SOUL.md']!).toString('utf8'), FILES['SOUL.md'])
      assert.equal(Buffer.from(read.files['agent-card.json']!).toString('utf8'), cardBytes.toString('utf8'))
      assert.ok(read.files['skills/alpha/scripts/run.py'])
    }
    const lockedCid = rawCid(Buffer.from(serializeContinuitySnapshotEnvelope(ownerSignedEnvelope(buildEnvelopeFixtures())), 'utf8'))
    const missing = await fetchSnapshotIntoStore(identity, { cid: lockedCid, createdAt: entry.createdAt }, { ...deps, signer: localKeySigner(f.operatorKey) })
    assert.equal(missing.status, 'error')
  })
})

test('fetch reports a busy store as an error outcome instead of throwing', async () => {
  await withHome(async () => {
    const f = buildEnvelopeFixtures()
    const envelopeBytes = Buffer.from(serializeContinuitySnapshotEnvelope(ownerSignedEnvelope(f)), 'utf8')
    const cid = rawCid(envelopeBytes)
    const identity = { address: f.ownerAddress, chainId: 1, identityRegistryAddress: ENVELOPE_REGISTRY.identityRegistryAddress, agentId: '42' } as EthagentIdentity
    const lock = path.join(snapshotStoreDir(identity), 'lock')
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, `${process.ppid}\n`)
    const outcome = await fetchSnapshotIntoStore(identity, { cid, createdAt: '2026-01-01T00:00:00.000Z' }, {
      apiUrl: 'https://uploads.pinata.cloud/v3/files',
      fetchImpl: fakeFetch(new Map([[cid, envelopeBytes]])),
      retries: 0,
      lockWaitMs: 0,
      signer: localKeySigner(f.operatorKey),
    })
    assert.equal(outcome.status, 'error')
    assert.match(outcome.error ?? '', /another ethagent process/)
    await fs.rm(lock)
  })
})

test('fetch rejects a body that does not match its CID', async () => {
  await withHome(async () => {
    const f = buildEnvelopeFixtures()
    const real = Buffer.from(serializeContinuitySnapshotEnvelope(ownerSignedEnvelope(f)), 'utf8')
    const cid = rawCid(real)
    const fetchImpl = fakeFetch(new Map([[cid, Buffer.from('{"tampered":true}')]]))
    const identity = { address: f.ownerAddress, chainId: 1, identityRegistryAddress: ENVELOPE_REGISTRY.identityRegistryAddress, agentId: '42' } as EthagentIdentity
    const outcome = await fetchSnapshotIntoStore(identity, { cid, createdAt: '2026-01-01T00:00:00.000Z' }, {
      apiUrl: 'https://uploads.pinata.cloud/v3/files', fetchImpl, retries: 0, signer: localKeySigner(f.operatorKey),
    })
    assert.equal(outcome.status, 'error')
    assert.match(outcome.error ?? '', /does not match its CID/)
  })
})
