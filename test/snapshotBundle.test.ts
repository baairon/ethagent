import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAgentStateBackupEnvelope,
  createAgentStateRecoveryChallenge,
} from '../src/identity/backupEnvelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../src/identity/eth.js'
import {
  AGENT_SNAPSHOT_EXPORT_VERSION,
  createAgentSnapshotExportBundle,
  parseAgentSnapshotExportBundle,
  readAgentSnapshotExportBundle,
  serializeAgentSnapshotExportBundle,
} from '../src/identity/snapshotBundle.js'

test('agent snapshot export bundle keeps encrypted state portable without plaintext', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: signature,
    state: { privateMemory: 'owner-only memory' },
    createdAt: new Date(0).toISOString(),
  })

  const bundle = createAgentSnapshotExportBundle({
    identity: {
      source: 'erc8004',
      address: ownerAddress,
      ownerAddress,
      createdAt: new Date(0).toISOString(),
      chainId: 8453,
      rpcUrl: 'https://base.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: '42',
      agentUri: 'ipfs://bafy-metadata',
      metadataCid: 'bafy-metadata',
      backup: {
        cid: 'bafy-state',
        createdAt: new Date(0).toISOString(),
        envelopeVersion: envelope.envelopeVersion,
        ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
        status: 'pinned',
        ownerAddress,
      },
    },
    envelope,
    exportedAt: new Date(1).toISOString(),
  })
  const serialized = serializeAgentSnapshotExportBundle(bundle)
  const parsed = parseAgentSnapshotExportBundle(serialized)

  assert.equal(parsed.version, AGENT_SNAPSHOT_EXPORT_VERSION)
  assert.equal(parsed.ownerAddress, ownerAddress)
  assert.equal(parsed.stateCid, 'bafy-state')
  assert.equal(parsed.agentId, '42')
  assert.equal(serialized.includes('owner-only memory'), false)
  assert.equal(serialized.includes(signature), false)
  assert.equal('walletSignature' in parsed.envelope, false)
})

test('agent snapshot export bundle rejects owner/envelope mismatch', () => {
  const ownerPrivateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerPrivateKey)
  const otherAddress = addressFromPrivateKey(otherPrivateKey)
  const signature = signMessage(ownerPrivateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: signature,
    state: {},
  })

  assert.throws(() => createAgentSnapshotExportBundle({
    identity: {
      address: otherAddress,
      ownerAddress: otherAddress,
      createdAt: new Date(0).toISOString(),
      backup: {
        cid: 'bafy-state',
        createdAt: new Date(0).toISOString(),
        envelopeVersion: envelope.envelopeVersion,
        ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
        status: 'pinned',
      },
    },
    envelope,
  }), /envelope owner/)
})

test('agent snapshot export import accepts pasted JSON source', async () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: signature,
    state: { name: 'portable agent' },
    createdAt: new Date(0).toISOString(),
  })
  const bundle = createAgentSnapshotExportBundle({
    identity: {
      source: 'erc8004',
      address: ownerAddress,
      ownerAddress,
      createdAt: new Date(0).toISOString(),
      backup: {
        cid: 'bafy-state',
        createdAt: new Date(0).toISOString(),
        envelopeVersion: envelope.envelopeVersion,
        ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
        status: 'pinned',
      },
    },
    envelope,
  })

  const parsed = await readAgentSnapshotExportBundle(`\n${serializeAgentSnapshotExportBundle(bundle)}\n`)

  assert.equal(parsed.ownerAddress, ownerAddress)
  assert.equal(parsed.stateCid, 'bafy-state')
})
