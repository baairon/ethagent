import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import { RegisterAgentPreflightError } from '../../../../src/identity/registry/erc8004.js'
import { AgentStateOwnerMismatchError } from '../../../../src/identity/crypto/backupEnvelope.js'
import { STORAGE_CREDENTIAL_FORGET_COPY } from '../../../../src/identity/hub/flows/settings/StorageCredentialScreen.js'
import { IdentitySummary } from '../../../../src/identity/hub/components/IdentitySummary.js'
import { identityHubErrorView } from '../../../../src/identity/hub/model/errors.js'
import {
  displayCustodyMode,
  identityOwnerAddress,
  identityPerspective,
  readCustodyMode,
} from '../../../../src/identity/hub/model/custody.js'
import { ensValidationReasonText } from '../../../../src/identity/hub/model/ens.js'
import {
  chainSummaryRow,
  networkLabel,
  networkSubtitle,
} from '../../../../src/identity/hub/model/network.js'
import {
  identitySummaryRows,
  isCurrentAgentCandidate,
  lastBackupLabel,
  tokenCandidateHint,
  tokenCandidateLabel,
  tokenCandidateSelectLabel,
} from '../../../../src/identity/hub/model/identity.js'
import {
  copyableIdentityFields,
  identityValuesCopyHint,
} from '../../../../src/identity/hub/model/copy.js'
import { localChangeStatusView } from '../../../../src/identity/hub/model/continuity.js'
import { transferSnapshotView } from '../../../../src/identity/hub/model/transfer.js'

test('identity hub formats insufficient-funds preflight errors for compact display', () => {
  const view = identityHubErrorView(new RegisterAgentPreflightError({
    code: 'insufficient-funds',
    title: 'Not Enough ETH',
    detail: 'Need ~0.002 ETH. Wallet has 0.0004 ETH.',
    hint: 'Add ETH to this wallet, then try again.',
  }))

  assert.deepEqual(view, {
    title: 'Not Enough ETH',
    detail: 'Need ~0.002 ETH. Wallet has 0.0004 ETH.',
    hint: 'Add ETH to this wallet, then try again.',
  })
})

test('identity hub formats blocked registration without raw wallet language', () => {
  const view = identityHubErrorView(new RegisterAgentPreflightError({
    code: 'simulation-failed',
    title: 'Registration Blocked',
    detail: 'execution reverted: bad agentURI',
    hint: 'No transaction was sent.',
  }))

  assert.equal(view.title, 'Registration Blocked')
  assert.equal(view.detail, 'execution reverted: bad agentURI')
  assert.equal(view.hint, 'No transaction was sent.')
})

test('identity hub capitalizes generic identity errors', () => {
  const view = identityHubErrorView(new Error('wallet request timed out'))

  assert.equal(view.title, 'Identity Error')
  assert.equal(view.detail, 'Wallet Request Timed Out')
})

test('identity hub explains locked backups without generic decrypt copy', () => {
  const view = identityHubErrorView(new AgentStateOwnerMismatchError(
    '0x000000000000000000000000000000000000dEaD',
    '0x000000000000000000000000000000000000bEEF',
  ))

  assert.equal(view.title, 'Backup Locked to Another Wallet')
  assert.equal(view.detail, 'Wallet 0x0000...bEEF cannot read state encrypted for 0x0000...dEaD.')
  assert.equal(view.hint, 'Use the wallet that created this backup.')
})

test('identity hub explains missing restore access without generic identity error copy', () => {
  const view = identityHubErrorView(new Error('Restore Slot Missing: re-save this agent once with the owner wallet.'))

  assert.equal(view.title, 'Wallet Not Included In Snapshot')
  assert.equal(view.detail, 'ERC-8004 metadata authorizes this wallet, but the latest encrypted snapshot was saved before this wallet had restore access.')
  assert.equal(view.hint, 'Use the owner wallet once to save a fresh snapshot, then restore with this wallet.')
})

test('identity hub summary always shows the short state CID for the menu card', () => {
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

  assert.deepEqual(rows.map(row => row.label), ['owner wallet', 'token', 'network', 'state', 'skills', 'card', 'icon'])
  assert.equal(rows[3]?.value, 'bafybeigdy...3w6y7q')
  assert.equal(rows[0]?.value, '0x0000...dEaD')
  assert.equal(rows[5]?.value, 'not saved')
  assert.equal(rows[6]?.value, 'not attached')
})

test('identity hub summary collapses gracefully when no identity is loaded', () => {
  const rows = identitySummaryRows(undefined)
  assert.deepEqual(rows.map(row => row.label), ['owner wallet', 'token', 'network', 'state', 'skills', 'card', 'icon'])
  assert.equal(rows[0]?.value, 'not connected')
  assert.equal(rows[1]?.value, 'not created')
  assert.equal(rows[2]?.value, 'ethereum mainnet')
  assert.equal(rows[3]?.value, 'not saved yet')
  assert.equal(rows[4]?.value, 'not saved')
  assert.equal(rows[5]?.value, 'not saved')
  assert.equal(rows[6]?.value, 'not attached')
})

test('ensValidationReasonText covers advanced ENS ownership codes', () => {
  assert.equal(ensValidationReasonText('token-owner-mismatch'), 'Token not held by owner wallet')
  assert.equal(ensValidationReasonText('token-owner-lookup-failed'), 'Could not verify ERC-8004 token owner')
  assert.equal(ensValidationReasonText('no-owner'), 'Name does not exist on ENS')
  assert.equal(ensValidationReasonText(undefined), 'Not yet verified')
})

test('localChangeStatusView returns empty detail when working status is undefined to avoid status flash', () => {
  const status = localChangeStatusView(undefined)
  assert.equal(status.detail, '')
  assert.equal(status.hasLocalChanges, false)
  assert.equal(status.tone, 'dim')
})

test('identity hub local change status distinguishes clean and changed files', () => {
  const published = {
    'SOUL.md': 'soul-a',
    'MEMORY.md': 'memory-a',
    'skills.json': 'skills-a',
  }
  const clean = localChangeStatusView({
    ready: true,
    localChangedAfterBackup: false,
    publishState: 'published',
    localContentHashes: published,
    publishedContentHashes: published,
  })
  assert.equal(clean.detail, 'None detected')
  assert.equal(clean.tone, 'ok')
  assert.equal(clean.hasLocalChanges, false)

  const changed = localChangeStatusView({
    ready: true,
    localChangedAfterBackup: true,
    publishState: 'local-changes',
    localContentHashes: {
      'SOUL.md': 'soul-b',
      'MEMORY.md': 'memory-a',
      'skills.json': 'skills-b',
    },
    publishedContentHashes: published,
  })
  assert.equal(changed.detail, 'Detected: SOUL.md, skills.json')
  assert.deepEqual(changed.files, ['SOUL.md', 'skills.json'])
  assert.equal(changed.tone, 'warn')
  assert.equal(changed.hasLocalChanges, true)
})

test('transfer snapshot view is perspective-aware', () => {
  const sender = '0x0000000000000000000000000000000000000A11'
  const receiver = '0x0000000000000000000000000000000000000B22'
  const base = {
    source: 'erc8004',
    address: sender,
    ownerAddress: sender,
    createdAt: new Date(0).toISOString(),
    backup: {
      cid: 'bafytransfer',
      createdAt: '2026-05-06T00:00:00.000Z',
      envelopeVersion: 'ethagent-continuity-snapshot-v1',
      ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
      status: 'pinned',
      transferSnapshot: {
        kind: 'dual-wallet',
        senderAddress: sender,
        receiverAddress: receiver,
        receiverHandle: 'agent.receiver.eth',
        slotCount: 2,
        createdAt: '2026-05-06T00:00:00.000Z',
      },
    },
  } as const

  assert.equal(transferSnapshotView(base)?.kind, 'ready-to-transfer')
  assert.equal(transferSnapshotView({ ...base, address: receiver, ownerAddress: receiver })?.kind, 'received')
  assert.equal(transferSnapshotView({
    ...base,
    address: '0x0000000000000000000000000000000000000C33',
    ownerAddress: '0x0000000000000000000000000000000000000C33',
  }), null)
  assert.equal(transferSnapshotView({
    ...base,
    backup: { ...base.backup, transferSnapshot: { ...base.backup.transferSnapshot, slotCount: 1 } },
  }), null)
})

test('storage credential confirmation distinguishes pinning control from identity cleanup', () => {
  const copy = STORAGE_CREDENTIAL_FORGET_COPY.join('\n')
  assert.match(copy, /saved IPFS storage token/)
  assert.match(copy, /existing pinned IPFS backups are not deleted/)
  assert.match(copy, /new encrypted snapshots cannot be pinned/)
  assert.match(copy, /identity and sessions stay/)
})

test('networkLabel and networkSubtitle return human-readable strings for every curated network', () => {
  assert.equal(networkLabel('mainnet'), 'ethereum mainnet')
  assert.equal(networkLabel('base'), 'base')
  for (const n of ['mainnet', 'base'] as const) {
    assert.ok(networkSubtitle(n).length > 0)
  }
})

test('identityValuesCopyHint only mentions ENS after an ENS name is linked', () => {
  assert.equal(identityValuesCopyHint({
    address: '0x000000000000000000000000000000000000dEaD',
    agentId: '45744',
    createdAt: new Date(0).toISOString(),
    state: {},
  }), 'Copy token and token URI pointers')

  assert.equal(identityValuesCopyHint({
    address: '0x000000000000000000000000000000000000dEaD',
    agentId: '45744',
    createdAt: new Date(0).toISOString(),
    state: { ensName: 'agent.example.eth' },
  }), 'Copy token, ENS, and token URI pointers')
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

test('networkSubtitle frames each network as a value-prop, not a jargon dump', () => {
  for (const n of ['mainnet', 'base'] as const) {
    const subtitle = networkSubtitle(n)
    assert.match(subtitle, /^Best for /)
    assertNoNetworkJargon(subtitle)
  }
  assert.match(networkSubtitle('mainnet'), /security/i)
  assert.match(networkSubtitle('base'), /lower-cost/i)
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
  assert.deepEqual(fields.map(f => f.label), ['Token ID', 'Agent URI', 'Owner Wallet'])
  assert.equal(fields.find(f => f.label === 'Agent URI')?.value, 'ipfs://bafkreib2')
  assert.equal(copyableIdentityFields(undefined).length, 0)
})

test('copyableIdentityFields exposes advanced ENS operator wallet state', () => {
  const identity = {
    address: '0x000000000000000000000000000000000000c01d',
    ownerAddress: '0x000000000000000000000000000000000000c01d',
    createdAt: new Date(0).toISOString(),
    agentId: '42',
    agentUri: 'ipfs://bafy-metadata',
    state: {
      custodyMode: 'advanced',
      ensName: 'agent.example.eth',
      ownerAddress: '0x000000000000000000000000000000000000c01d',
      operatorVaultAddress: '0x00000000000000000000000000000000000077AB',
      activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
      approvedOperatorWallets: [
        { address: '0x0000000000000000000000000000000000000A11', verifiedAt: '2026-05-04T00:00:00.000Z' },
        '0x0000000000000000000000000000000000000B22',
      ],
    },
  } as const
  const fields = copyableIdentityFields(identity)

  assert.deepEqual(fields.map(field => field.label), ['Token ID', 'ENS Name', 'Agent URI', 'Owner Wallet', 'OperatorVault', 'Operator Wallet'])
  assert.equal(fields.find(field => field.label === 'Owner Wallet')?.value, '0x000000000000000000000000000000000000c01d')
  assert.equal(fields.find(field => field.label === 'OperatorVault')?.value, '0x00000000000000000000000000000000000077AB')
  assert.equal(fields.find(field => field.label === 'Operator Wallet')?.value, '0x0000000000000000000000000000000000000A11')
  assert.equal(fields.find(field => field.label === 'Approved Operator Wallets'), undefined)
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

  assert.equal(tokenCandidateLabel(candidate), 'research agent')
  assert.equal(tokenCandidateHint(candidate), 'token #45744 · base · backup 2026-04-25')
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

  assert.equal(tokenCandidateLabel(candidate), 'Agent Token #1')
  assert.equal(tokenCandidateHint(candidate), 'ethereum mainnet')
})

test('current agent candidate marker requires the selected token identity', () => {
  const identity = {
    address: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    ownerAddress: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    createdAt: new Date(0).toISOString(),
    source: 'erc8004',
    agentId: '45744',
    agentUri: 'ipfs://bafy-metadata',
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  } as const
  const candidate = {
    ownerAddress: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    chainId: 8453,
    rpcUrl: 'https://base.publicnode.com',
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: 45744n,
    agentUri: 'ipfs://bafy-metadata',
    registration: null,
  } as const

  assert.equal(isCurrentAgentCandidate(identity, candidate), true)
  assert.equal(isCurrentAgentCandidate(identity, { ...candidate, agentId: 1n }), false)
  assert.equal(isCurrentAgentCandidate(identity, { ...candidate, chainId: 1 }), false)
  assert.equal(isCurrentAgentCandidate(undefined, candidate), false)
  assert.equal(tokenCandidateSelectLabel(candidate, true), 'Agent Token #45744  *')
  assert.equal(tokenCandidateSelectLabel(candidate, false), 'Agent Token #45744')
})

function assertNoNetworkJargon(value: string): void {
  assert.doesNotMatch(value, /ERC-8004/i)
  assert.doesNotMatch(value, /registry/i)
  assert.doesNotMatch(value, /registration/i)
}

test('setup and wallet copy uses owner/operator wording in user-facing labels', () => {
  const identity = {
    address: '0x000000000000000000000000000000000000c01d',
    ownerAddress: '0x000000000000000000000000000000000000c01d',
    createdAt: new Date(0).toISOString(),
    agentId: '42',
    agentUri: 'ipfs://bafy-metadata',
    state: {
      custodyMode: 'advanced',
      ensName: 'agent.example.eth',
      ownerAddress: '0x000000000000000000000000000000000000F00D',
      activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
      approvedOperatorWallets: [{ address: '0x0000000000000000000000000000000000000A11' }],
    },
  } as const
  const fields = copyableIdentityFields(identity)
  const labels = fields.map(f => f.label).join(' ')
  assert.match(labels, /Operator Wallet/)
  assert.match(labels, /Owner Wallet/)

  const ownerError = identityHubErrorView(new Error('owner wallet required: this needs the owner wallet'))
  assert.equal(ownerError.title, 'Owner Wallet Required')

  const operatorError = identityHubErrorView(new Error('operator wallet required: sign with operator wallet'))
  assert.equal(operatorError.title, 'Operator Wallet Required')
})

test('readCustodyMode reads new field directly', () => {
  assert.equal(readCustodyMode({ custodyMode: 'advanced' }), 'advanced')
  assert.equal(readCustodyMode({ custodyMode: 'simple' }), 'simple')
  assert.equal(readCustodyMode({}), undefined)
  assert.equal(readCustodyMode(undefined), undefined)
})

test('readCustodyMode migrates legacy single|multi values', () => {
  assert.equal(readCustodyMode({ custodyMode: 'multi' }), 'advanced')
  assert.equal(readCustodyMode({ custodyMode: 'single' }), 'simple')
})

test('readCustodyMode falls back to legacy ensMode for existing configs', () => {
  assert.equal(readCustodyMode({ ensMode: 'advanced' }), 'advanced')
  assert.equal(readCustodyMode({ ensMode: 'simple' }), 'simple')
})

test('readCustodyMode prefers new field over legacy when both present', () => {
  assert.equal(readCustodyMode({ custodyMode: 'simple', ensMode: 'advanced' }), 'simple')
  assert.equal(readCustodyMode({ custodyMode: 'multi', ensMode: 'simple' }), 'advanced')
})

test('displayCustodyMode renders user-facing custody labels', () => {
  assert.equal(displayCustodyMode('advanced'), 'Advanced')
  assert.equal(displayCustodyMode('simple'), 'Simple')
  assert.equal(displayCustodyMode(undefined), 'Not set')
})

test('identityOwnerAddress prefers verified onchain owner and falls back to local owner', () => {
  const localOwner = '0x000000000000000000000000000000000000dEaD'
  const stateOwner = '0x000000000000000000000000000000000000c01d'
  const onchainOwner = '0x000000000000000000000000000000000000bEEF'
  const identity = {
    address: localOwner,
    ownerAddress: localOwner,
    createdAt: '2026-05-09T00:00:00.000Z',
    state: { ownerAddress: stateOwner },
  }

  assert.equal(identityOwnerAddress(identity, onchainOwner), onchainOwner)
  assert.equal(identityOwnerAddress(identity), stateOwner)
  assert.equal(identityOwnerAddress({ ...identity, state: {} }), localOwner)
})

test('identity summary shows simple-mode owner and uses verified onchain owner as authoritative', () => {
  const localOwner = '0x000000000000000000000000000000000000dEaD'
  const onchainOwner = '0x000000000000000000000000000000000000bEEF'
  const output = renderToString(React.createElement(IdentitySummary, {
    identity: {
      address: localOwner,
      ownerAddress: localOwner,
      createdAt: '2026-05-09T00:00:00.000Z',
      agentId: '42',
      state: { custodyMode: 'simple' },
    },
    hideLocalChanges: true,
    onchainOwner,
  }))

  assert.match(output, /Owner\s+0x0000\.\.\.bEEF/)
  assert.doesNotMatch(output, /Owner\s+0x0000\.\.\.dEaD/)
})

test('identityPerspective: undefined identity is unknown', () => {
  assert.equal(identityPerspective(undefined), 'unknown')
})

test('identityPerspective: missing connectedWallet is unknown', () => {
  assert.equal(identityPerspective({
    address: '0xA1E977e700bF82019beb381F1582575303A389CE',
    createdAt: '2026-05-09T00:00:00.000Z',
    state: { ownerAddress: '0xA1E977e700bF82019beb381F1582575303A389CE' },
  }), 'unknown')
})

test('identityPerspective: connected wallet matches owner wallet -> owner', () => {
  assert.equal(identityPerspective({
    address: '0xc968C95FB7897165375bd14b03aaCE5Bc38CD1Ba',
    createdAt: '2026-05-09T00:00:00.000Z',
    connectedWallet: '0xA1E977e700bF82019beb381F1582575303A389CE',
    state: { ownerAddress: '0xA1E977e700bF82019beb381F1582575303A389CE' },
  }), 'owner')
})

test('identityPerspective: connected wallet matches active operator -> operator', () => {
  assert.equal(identityPerspective({
    address: '0xc968C95FB7897165375bd14b03aaCE5Bc38CD1Ba',
    createdAt: '2026-05-09T00:00:00.000Z',
    connectedWallet: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    state: {
      ownerAddress: '0xA1E977e700bF82019beb381F1582575303A389CE',
      activeOperatorAddress: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    },
  }), 'operator')
})

test('identityPerspective: connected wallet in approvedOperatorWallets -> operator', () => {
  assert.equal(identityPerspective({
    address: '0xc968C95FB7897165375bd14b03aaCE5Bc38CD1Ba',
    createdAt: '2026-05-09T00:00:00.000Z',
    connectedWallet: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    state: {
      ownerAddress: '0xA1E977e700bF82019beb381F1582575303A389CE',
      approvedOperatorWallets: [{ address: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394' }],
    },
  }), 'operator')
})

test('identityPerspective: unknown wallet returns unknown', () => {
  assert.equal(identityPerspective({
    address: '0xc968C95FB7897165375bd14b03aaCE5Bc38CD1Ba',
    createdAt: '2026-05-09T00:00:00.000Z',
    connectedWallet: '0x1111111111111111111111111111111111111111',
    state: {
      ownerAddress: '0xA1E977e700bF82019beb381F1582575303A389CE',
      activeOperatorAddress: '0x8DDe0C47EdC7C0a0745f56d4BB92a959CD0c5394',
    },
  }), 'unknown')
})
