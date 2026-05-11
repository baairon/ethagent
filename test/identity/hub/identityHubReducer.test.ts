import test from 'node:test'
import assert from 'node:assert/strict'
import {
  identityHubReducer,
  createStepNumber,
  CREATE_STEP_LABELS,
  type Step,
} from '../../../src/identity/hub/identityHubReducer.js'

const registry = {
  chainId: 1,
  rpcUrl: 'https://example.com',
  identityRegistryAddress: '0x0000000000000000000000000000000000000001' as `0x${string}`,
}

const identity = {
  source: 'erc8004' as const,
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  agentId: '1',
  agentUri: 'ipfs://agent',
}

const ensSetup = {
  mode: 'advanced' as const,
  rootName: 'example.eth',
  label: 'agent',
  fullName: 'agent.example.eth',
  ownerAddress: '0x000000000000000000000000000000000000dEaD' as `0x${string}`,
  operatorAddress: '0x0000000000000000000000000000000000000A11' as `0x${string}`,
  resolverAddress: '0x0000000000000000000000000000000000001234' as `0x${string}`,
  registryAction: 'create-subdomain' as const,
  addressRecord: {
    current: null,
    next: '0x000000000000000000000000000000000000dEaD' as `0x${string}`,
    changed: true,
  },
  currentRecords: {},
  nextRecords: { token: 'eip155:1:0x1:1' },
  recordDiffs: [],
  txCount: 2,
  warnings: [],
}

test('identityHubReducer: setStep replaces the current step', () => {
  let state: Step = { kind: 'menu' }
  state = identityHubReducer(state, { type: 'setStep', step: { kind: 'create-name' } })
  assert.equal(state.kind, 'create-name')

  state = identityHubReducer(state, { type: 'setStep', step: { kind: 'create-description', name: 'myagent' } })
  assert.equal(state.kind, 'create-description')

  state = identityHubReducer(state, { type: 'setStep', step: { kind: 'create-network', name: 'myagent', description: 'test agent' } })
  assert.equal(state.kind, 'create-network')
})

test('identityHubReducer: create back preserves local inputs', () => {
  const network: Step = { kind: 'create-network', name: 'pip', description: 'helper' }
  const previous = identityHubReducer(network, { type: 'back', from: network })
  assert.equal(previous.kind, 'create-description')
  if (previous.kind === 'create-description') assert.equal(previous.name, 'pip')

  const signing: Step = { kind: 'create-signing', name: 'pip', description: 'helper', registry, custodyMode: 'simple' }
  const backToCustody = identityHubReducer(signing, { type: 'back', from: signing })
  assert.equal(backToCustody.kind, 'create-custody')
  if (backToCustody.kind === 'create-custody') {
    assert.equal(backToCustody.name, 'pip')
    assert.equal(backToCustody.description, 'helper')
  }
})

test('identityHubReducer: restore wallet and network back return to hub', () => {
  const wallet: Step = { kind: 'restore-wallet', purpose: 'switch' }
  assert.equal(identityHubReducer(wallet, { type: 'back', from: wallet }).kind, 'menu')

  const network: Step = { kind: 'restore-network', ownerHandle: 'owner.eth', purpose: 'switch' }
  assert.equal(identityHubReducer(network, { type: 'back', from: network }).kind, 'menu')
})

test('identityHubReducer: restore search result steps back to network selection', () => {
  const notFound: Step = { kind: 'restore-not-found', ownerHandle: 'owner.eth', registry, reason: 'no-owner-or-operator', purpose: 'switch' }
  const backToNetwork = identityHubReducer(notFound, { type: 'back', from: notFound })
  assert.equal(backToNetwork.kind, 'restore-network')
  if (backToNetwork.kind === 'restore-network') assert.equal(backToNetwork.ownerHandle, 'owner.eth')

  const select: Step = { kind: 'restore-select-token', ownerHandle: 'owner.eth', registry, candidates: [], purpose: 'restore' }
  assert.equal(identityHubReducer(select, { type: 'back', from: select }).kind, 'restore-network')
})

test('identityHubReducer: top-level identity subviews back to hub', () => {
  assert.equal(identityHubReducer({ kind: 'details' }, { type: 'back', from: { kind: 'details' } }).kind, 'menu')
  assert.equal(identityHubReducer({ kind: 'continuity-public' }, { type: 'back', from: { kind: 'continuity-public' } }).kind, 'menu')
  assert.equal(identityHubReducer({ kind: 'continuity-private' }, { type: 'back', from: { kind: 'continuity-private' } }).kind, 'menu')
  assert.equal(identityHubReducer({ kind: 'rebackup-confirm', back: { kind: 'menu' } }, { type: 'back', from: { kind: 'rebackup-confirm', back: { kind: 'menu' } } }).kind, 'menu')
  assert.equal(identityHubReducer({ kind: 'recovery-refetch-confirm', back: { kind: 'menu' } }, { type: 'back', from: { kind: 'recovery-refetch-confirm', back: { kind: 'menu' } } }).kind, 'menu')
  assert.equal(identityHubReducer({ kind: 'storage-credential-input' }, { type: 'back', from: { kind: 'storage-credential-input' } }).kind, 'menu')
})

test('identityHubReducer: edit profile back preserves identity and registry', () => {
  const state: Step = { kind: 'edit-profile-description', identity, registry, name: 'pip', description: 'line one\nline two', imagePath: 'ipfs://icon.png', returnTo: { kind: 'continuity-public' } }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-name')
  if (next.kind === 'edit-profile-name') {
    assert.equal(next.identity.address, identity.address)
    assert.equal(next.registry.chainId, registry.chainId)
    assert.equal(next.name, 'pip')
    assert.equal(next.description, 'line one\nline two')
    assert.equal(next.imagePath, 'ipfs://icon.png')
    assert.deepEqual(next.returnTo, { kind: 'continuity-public' })
  }
})

test('identityHubReducer: profile draft survives back through review and icon steps', () => {
  const review: Step = {
    kind: 'edit-profile-review',
    identity,
    registry,
    name: 'draft name',
    description: 'first line\nsecond line',
    imagePath: 'https://example.com/icon.webp',
    returnTo: { kind: 'continuity-public' },
  }
  const icon = identityHubReducer(review, { type: 'back', from: review })
  assert.equal(icon.kind, 'edit-profile-image')
  if (icon.kind !== 'edit-profile-image') return
  assert.equal(icon.name, 'draft name')
  assert.equal(icon.description, 'first line\nsecond line')
  assert.equal(icon.imagePath, 'https://example.com/icon.webp')

  const description = identityHubReducer(icon, { type: 'back', from: icon })
  assert.equal(description.kind, 'edit-profile-description')
  if (description.kind !== 'edit-profile-description') return
  assert.equal(description.name, 'draft name')
  assert.equal(description.description, 'first line\nsecond line')
  assert.equal(description.imagePath, 'https://example.com/icon.webp')
})

test('identityHubReducer: ens-records-tx back returns to edit-profile-ens', () => {
  const state: Step = {
    kind: 'ens-records-tx',
    identity,
    registry,
    fullName: 'ethagent.example.eth',
    records: { token: 'eip155:1:0x1:1' },
    returnTo: { kind: 'menu' },
  }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-ens')
  if (next.kind === 'edit-profile-ens') {
    assert.equal(next.identity.address, identity.address)
    assert.equal(next.registry.chainId, registry.chainId)
    assert.deepEqual(next.returnTo, { kind: 'menu' })
  }
})

test('identityHubReducer: ENS setup tx back returns to advanced ENS setup', () => {
  const state: Step = {
    kind: 'ens-setup-registry-tx',
    identity,
    registry,
    setup: ensSetup,
    returnTo: { kind: 'continuity-public' },
  }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-ens')
  if (next.kind === 'edit-profile-ens') {
    assert.equal(next.initialView, 'advanced')
    assert.deepEqual(next.returnTo, { kind: 'continuity-public' })
  }
})

test('identityHubReducer: token transfer target backs to hub', () => {
  const state: Step = { kind: 'token-transfer-target', identity, registry }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: token transfer can return to advanced ENS setup', () => {
  const returnTo: Step = { kind: 'edit-profile-ens', identity, registry, returnTo: { kind: 'menu' }, initialView: 'advanced' }
  const target: Step = { kind: 'token-transfer-target', identity, registry, returnTo }
  const signing: Step = {
    kind: 'token-transfer-signing',
    identity,
    registry,
    targetHandle: 'owner.eth',
    targetAddress: '0x0000000000000000000000000000000000000c0d',
    returnTo,
  }
  const ready: Step = {
    kind: 'token-transfer-ready',
    identity,
    registry,
    targetHandle: 'owner.eth',
    targetAddress: '0x0000000000000000000000000000000000000c0d',
    snapshotCid: 'bafy',
    txHash: '0xhash',
    returnTo,
  }

  assert.deepEqual(identityHubReducer(target, { type: 'back', from: target }), returnTo)
  const signingBack = identityHubReducer(signing, { type: 'back', from: signing })
  assert.equal(signingBack.kind, 'token-transfer-target')
  if (signingBack.kind === 'token-transfer-target') assert.deepEqual(signingBack.returnTo, returnTo)
  assert.deepEqual(identityHubReducer(ready, { type: 'back', from: ready }), returnTo)
})

test('identityHubReducer: backup approval returns to hub', () => {
  const state: Step = { kind: 'rebackup-signing', identity, registry }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: error back returns the stored step', () => {
  const errorState: Step = {
    kind: 'error',
    error: { title: 'test' },
    back: { kind: 'restore-network', ownerHandle: 'owner.eth' },
  }
  const next = identityHubReducer(errorState, { type: 'back', from: errorState })
  assert.equal(next.kind, 'restore-network')
})

test('identityHubReducer: save-prompt back returns the stored step', () => {
  const state: Step = { kind: 'save-prompt', back: { kind: 'menu' } }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('createStepNumber matches the current create flow', () => {
  assert.equal(createStepNumber({ kind: 'create-name' }), 1)
  assert.equal(createStepNumber({ kind: 'create-description', name: 'test' }), 2)
  assert.equal(createStepNumber({ kind: 'create-network', name: 'test', description: '' }), 3)
  assert.equal(createStepNumber({ kind: 'create-custody', name: 'test', description: '' }), 4)
  assert.equal(createStepNumber({ kind: 'create-signing', name: 'test', description: '', registry, custodyMode: 'simple' }), 5)
  assert.equal(createStepNumber({ kind: 'menu' }), 0)
  assert.deepEqual(CREATE_STEP_LABELS, ['Name', 'Describe', 'Network', 'Custody', 'Create'])
})
