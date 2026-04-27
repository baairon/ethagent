import test from 'node:test'
import assert from 'node:assert/strict'
import { RegisterAgentPreflightError } from '../src/identity/erc8004.js'
import { AgentStateOwnerMismatchError } from '../src/identity/backupEnvelope.js'
import { FORGET_LOCAL_AGENT_COPY } from '../src/identity/screens/ForgetIdentityScreen.js'
import { STORAGE_CREDENTIAL_FORGET_COPY } from '../src/identity/screens/StorageCredentialScreen.js'
import {
  chainSummaryRow,
  copyableIdentityFields,
  currentNetworkLine,
  identityHubErrorView,
  identityDetailSections,
  identitySummaryRows,
  lastBackupLabel,
  networkLabel,
  networkMenuTagline,
  networkSubtitle,
  selectedNetworkFooter,
  storageLabel,
  tokenCandidateHint,
  tokenCandidateLabel,
} from '../src/identity/identityHubModel.js'

test('identity hub formats insufficient-funds preflight errors for compact display', () => {
  const view = identityHubErrorView(new RegisterAgentPreflightError({
    code: 'insufficient-funds',
    title: 'not enough ETH',
    detail: 'Need ~0.002 ETH. Wallet has 0.0004 ETH.',
    hint: 'Add ETH to this wallet, then try again.',
  }))

  assert.deepEqual(view, {
    title: 'not enough ETH',
    detail: 'Need ~0.002 ETH. Wallet has 0.0004 ETH.',
    hint: 'Add ETH to this wallet, then try again.',
  })
})

test('identity hub formats blocked registration without raw wallet language', () => {
  const view = identityHubErrorView(new RegisterAgentPreflightError({
    code: 'simulation-failed',
    title: 'registration blocked',
    detail: 'execution reverted: bad agentURI',
    hint: 'No transaction was sent.',
  }))

  assert.equal(view.title, 'registration blocked')
  assert.equal(view.detail, 'execution reverted: bad agentURI')
  assert.equal(view.hint, 'No transaction was sent.')
})

test('identity hub explains transferred-token snapshots without generic decrypt copy', () => {
  const view = identityHubErrorView(new AgentStateOwnerMismatchError(
    '0x000000000000000000000000000000000000dEaD',
    '0x000000000000000000000000000000000000bEEF',
  ))

  assert.equal(view.title, 'snapshot locked to previous wallet')
  assert.equal(view.detail, 'token owner 0x0000...bEEF cannot read state encrypted for 0x0000...dEaD.')
  assert.equal(view.hint, 'Use the wallet that authorized this snapshot.')
})

test('identity hub summary always shows the short state CID for the menu card', () => {
  assert.equal(storageLabel('https://uploads.pinata.cloud/v3/files'), 'Pinata')
  const rows = identitySummaryRows({
    source: 'erc8004',
    address: '0x000000000000000000000000000000000000dEaD',
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    createdAt: new Date(0).toISOString(),
    agentId: '42',
    backup: {
      cid: 'bafybeigdyrztma2dbfczw7q6ooozbxlqzyw5r7w4f3qw2axvvxqg3w6y7q',
      createdAt: new Date(0).toISOString(),
      envelopeVersion: 'ethagent-state-backup-v1',
      ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
      status: 'pinned',
    },
  })

  assert.deepEqual(rows.map(row => row.label), ['owner', 'token', 'state'])
  assert.equal(rows[2]?.value, 'bafybeigdy...3w6y7q')
  assert.equal(rows[0]?.value, '0x0000...dEaD')
})

test('identity hub summary collapses gracefully when no identity is loaded', () => {
  const rows = identitySummaryRows(undefined)
  assert.deepEqual(rows.map(row => row.label), ['owner', 'token', 'state'])
  assert.equal(rows[0]?.value, 'not connected')
  assert.equal(rows[1]?.value, 'not created')
  assert.equal(rows[2]?.value, 'not saved yet')
})

test('forget local agent confirmation keeps the local wipe boundary explicit', () => {
  const copy = FORGET_LOCAL_AGENT_COPY.join('\n')
  assert.match(copy, /active local agent/)
  assert.match(copy, /legacy stored local private key/)
  assert.match(copy, /does not burn, transfer, or delete agent tokens/)
  assert.match(copy, /does not delete IPFS snapshots/)
  assert.match(copy, /does not delete sessions or chats/)
})

test('storage credential confirmation distinguishes pinning control from identity cleanup', () => {
  const copy = STORAGE_CREDENTIAL_FORGET_COPY.join('\n')
  assert.match(copy, /saved IPFS storage token/)
  assert.match(copy, /existing pinned files and snapshots are not deleted/)
  assert.match(copy, /cannot pin new encrypted state/)
  assert.match(copy, /agent identity and sessions stay/)
})

test('networkLabel and networkSubtitle return human-readable strings for every curated network', () => {
  assert.equal(networkLabel('mainnet'), 'ethereum mainnet')
  assert.equal(networkLabel('arbitrum'), 'arbitrum one')
  assert.equal(networkLabel('base'), 'base')
  assert.equal(networkLabel('optimism'), 'optimism')
  assert.equal(networkLabel('polygon'), 'polygon')
  for (const n of ['mainnet', 'arbitrum', 'base', 'optimism', 'polygon'] as const) {
    assert.ok(networkSubtitle(n).length > 0)
  }
})

test('currentNetworkLine reflects selectedNetwork preference, defaulting to mainnet', () => {
  assert.equal(currentNetworkLine(undefined), 'ethereum mainnet')
  assert.equal(currentNetworkLine({
    version: 1,
    provider: 'openai',
    model: 'gpt-test',
    firstRunAt: new Date(0).toISOString(),
    selectedNetwork: 'arbitrum',
  }), 'arbitrum one')
})

test('chainSummaryRow prefers identity.chainId, falls back to selectedNetwork', () => {
  const onMainnet = chainSummaryRow(
    { version: 1, provider: 'openai', model: 'gpt-test', firstRunAt: new Date(0).toISOString(), selectedNetwork: 'base' },
    undefined,
  )
  assert.equal(onMainnet.value, 'base')
  assert.equal(onMainnet.tone, 'dim')

  const fromIdentity = chainSummaryRow(
    { version: 1, provider: 'openai', model: 'gpt-test', firstRunAt: new Date(0).toISOString(), selectedNetwork: 'base' },
    {
      address: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      chainId: 1,
    },
  )
  assert.equal(fromIdentity.value, 'ethereum mainnet')
  assert.equal(fromIdentity.tone, 'ok')
})

test('selectedNetworkFooter uses concise user-facing network copy', () => {
  const footer = selectedNetworkFooter({
    version: 1,
    provider: 'openai',
    model: 'gpt-test',
    firstRunAt: new Date(0).toISOString(),
    selectedNetwork: 'base',
  })
  assert.equal(footer, 'network: base')
  assertNoNetworkJargon(footer)
  assert.doesNotMatch(footer, /token contract/i)
  assert.doesNotMatch(footer, /0x8004/i)
})

test('networkMenuTagline explains network selection without protocol jargon', () => {
  assert.equal(networkMenuTagline(), 'choose where your agent token is created or found.')
  assertNoNetworkJargon(networkMenuTagline())
})

test('networkSubtitle uses concise agent-token language', () => {
  for (const n of ['mainnet', 'arbitrum', 'base', 'optimism', 'polygon'] as const) {
    const subtitle = networkSubtitle(n)
    assert.match(subtitle, /agent tokens on /)
    assertNoNetworkJargon(subtitle)
    assert.equal(subtitle, subtitle.toLowerCase())
  }
})

test('identityDetailSections show full state CID and registration CID without truncation', () => {
  const cid = 'bafybeigdyrztma2dbfczw7q6ooozbxlqzyw5r7w4f3qw2axvvxqg3w6y7q'
  const metadataCid = 'bafkreib2abcdefghijklmnopqrstuvwxyzjsyzdy'
  const sections = identityDetailSections({
    source: 'erc8004',
    address: '0x000000000000000000000000000000000000dEaD',
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    createdAt: '2026-03-15T00:00:00.000Z',
    agentId: '42',
    metadataCid,
    agentUri: `ipfs://${metadataCid}`,
    backup: {
      cid,
      createdAt: '2026-04-25T00:00:00.000Z',
      envelopeVersion: 'ethagent-state-backup-v1',
      ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
      status: 'pinned',
    },
  })
  const recovery = sections.find(section => section.title === 'Recovery')
  const agent = sections.find(section => section.title === 'Agent')
  const owner = sections.find(section => section.title === 'Owner')
  assert.equal(recovery?.rows.find(row => row.label === 'state CID')?.value, cid)
  assert.equal(recovery?.rows.find(row => row.label === 'created')?.value, '2026-03-15')
  assert.equal(recovery?.rows.find(row => row.label === 'last backup')?.value, '2026-04-25')
  assert.equal(agent?.rows.find(row => row.label === 'registration')?.value, metadataCid)
  assert.equal(agent?.rows.some(row => row.label === 'agent URI'), false, 'agent URI is now derivable from registration')
  assert.equal(owner?.rows.some(row => row.label === 'source'), false, 'source row was removed as dead weight')
})

test('lastBackupLabel renders never until a backup exists', () => {
  assert.equal(lastBackupLabel(undefined), 'never')
  assert.equal(lastBackupLabel({ address: '0x', createdAt: new Date(0).toISOString() }), 'never')
  assert.equal(lastBackupLabel({
    address: '0x',
    createdAt: new Date(0).toISOString(),
    backup: {
      cid: 'bafy',
      createdAt: '2026-04-25T00:00:00.000Z',
      envelopeVersion: 'ethagent-state-backup-v1',
      ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
      status: 'pinned',
    },
  }), '2026-04-25')
})

test('copyableIdentityFields returns the user-actionable values for the copy picker', () => {
  const fields = copyableIdentityFields({
    address: '0x000000000000000000000000000000000000dEaD',
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    createdAt: new Date(0).toISOString(),
    agentId: '42',
    metadataCid: 'bafkreib2',
    agentUri: 'ipfs://bafkreib2',
    backup: {
      cid: 'bafybei',
      createdAt: new Date(0).toISOString(),
      envelopeVersion: 'ethagent-state-backup-v1',
      ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
      status: 'pinned',
    },
  })
  assert.deepEqual(fields.map(f => f.label), ['state CID', 'registration CID', 'agent URI', 'owner address', 'token id'])
  assert.equal(copyableIdentityFields(undefined).length, 0)
})

test('token candidate hint stays terse so wallets with many agents stay scannable', () => {
  const candidate = {
    ownerAddress: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    chainId: 8453,
    rpcUrl: 'https://base.publicnode.com',
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: 45744n,
    agentUri: 'ipfs://bafy-metadata',
    name: 'research agent',
    backup: {
      cid: 'bafkreib2abcdefghijklmnopqrstuvwxyzjsyzdy',
      createdAt: '2026-04-25T00:00:00.000Z',
    },
    registration: null,
  } as const

  assert.equal(tokenCandidateLabel(candidate), '#45744 · research agent')
  assert.equal(tokenCandidateHint(candidate), 'base · pinned 2026-04-25')
  assert.doesNotMatch(tokenCandidateHint(candidate), /owner/)
  assert.doesNotMatch(tokenCandidateHint(candidate), /state/)
})

test('token candidate hint falls back to network only when no backup is pinned yet', () => {
  const candidate = {
    ownerAddress: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    chainId: 1,
    rpcUrl: 'https://eth.publicnode.com',
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: 1n,
    agentUri: 'ipfs://bafy',
    registration: null,
  } as const

  assert.equal(tokenCandidateHint(candidate), 'ethereum mainnet')
})

function assertNoNetworkJargon(value: string): void {
  assert.doesNotMatch(value, /ERC-8004/i)
  assert.doesNotMatch(value, /registry/i)
  assert.doesNotMatch(value, /registration/i)
}
