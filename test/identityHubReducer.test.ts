import test from 'node:test'
import assert from 'node:assert/strict'
import {
  identityHubReducer,
  createStepNumber,
  CREATE_STEP_LABELS,
  type Step,
} from '../src/identity/identityHubReducer.js'

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

test('identityHubReducer: create flow steps forward through network selection', () => {
  let state: Step = { kind: 'menu' }
  state = identityHubReducer(state, { type: 'startCreate', hasIdentity: false })
  assert.equal(state.kind, 'create-name')

  state = identityHubReducer(state, { type: 'nameSubmitted', name: 'myagent' })
  assert.equal(state.kind, 'create-description')

  state = identityHubReducer(state, { type: 'descriptionSubmitted', name: 'myagent', description: 'test agent' })
  assert.equal(state.kind, 'create-network')
})

test('identityHubReducer: create back preserves local inputs', () => {
  const network: Step = { kind: 'create-network', name: 'pip', description: 'helper' }
  const previous = identityHubReducer(network, { type: 'back', from: network })
  assert.equal(previous.kind, 'create-description')
  if (previous.kind === 'create-description') assert.equal(previous.name, 'pip')

  const signing: Step = { kind: 'create-signing', name: 'pip', description: 'helper', registry }
  const backToNetwork = identityHubReducer(signing, { type: 'back', from: signing })
  assert.equal(backToNetwork.kind, 'create-network')
  if (backToNetwork.kind === 'create-network') {
    assert.equal(backToNetwork.name, 'pip')
    assert.equal(backToNetwork.description, 'helper')
  }
})

test('identityHubReducer: restore back returns to previous restore step instead of hub', () => {
  const network: Step = { kind: 'restore-network', ownerHandle: 'owner.eth', purpose: 'switch' }
  const owner = identityHubReducer(network, { type: 'back', from: network })
  assert.equal(owner.kind, 'restore-owner')
  if (owner.kind === 'restore-owner') {
    assert.equal(owner.purpose, 'switch')
  }

  const tokenId: Step = { kind: 'restore-token-id', ownerHandle: 'owner.eth', registry, purpose: 'switch' }
  const backToNetwork = identityHubReducer(tokenId, { type: 'back', from: tokenId })
  assert.equal(backToNetwork.kind, 'restore-network')
  if (backToNetwork.kind === 'restore-network') assert.equal(backToNetwork.ownerHandle, 'owner.eth')

  const select: Step = { kind: 'restore-select-token', ownerHandle: 'owner.eth', registry, candidates: [], purpose: 'restore' }
  assert.equal(identityHubReducer(select, { type: 'back', from: select }).kind, 'restore-network')
})

test('identityHubReducer: details subviews back to settings, then hub', () => {
  const copy: Step = { kind: 'details', copyPicker: true }
  const plain = identityHubReducer(copy, { type: 'back', from: copy })
  assert.deepEqual(plain, { kind: 'details' })

  assert.equal(identityHubReducer({ kind: 'details' }, { type: 'back', from: { kind: 'details' } }).kind, 'menu')
  assert.equal(identityHubReducer({ kind: 'forget-confirm' }, { type: 'back', from: { kind: 'forget-confirm' } }).kind, 'details')
  assert.equal(identityHubReducer({ kind: 'data-management' }, { type: 'back', from: { kind: 'data-management' } }).kind, 'details')
  assert.equal(identityHubReducer({ kind: 'storage-credential-input' }, { type: 'back', from: { kind: 'storage-credential-input' } }).kind, 'details')
})

test('identityHubReducer: edit profile back preserves identity and registry', () => {
  const state: Step = { kind: 'edit-profile-description', identity, registry, name: 'pip' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-name')
  if (next.kind === 'edit-profile-name') {
    assert.equal(next.identity.address, identity.address)
    assert.equal(next.registry.chainId, registry.chainId)
  }
})

test('identityHubReducer: backup approval returns to settings', () => {
  const state: Step = { kind: 'rebackup-signing', identity, registry }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'details')
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

test('createStepNumber matches the current create flow', () => {
  assert.equal(createStepNumber({ kind: 'create-name' }), 1)
  assert.equal(createStepNumber({ kind: 'create-description', name: 'test' }), 2)
  assert.equal(createStepNumber({ kind: 'create-network', name: 'test', description: '' }), 3)
  assert.equal(createStepNumber({ kind: 'create-signing', name: 'test', description: '', registry }), 4)
  assert.equal(createStepNumber({ kind: 'menu' }), 0)
  assert.deepEqual(CREATE_STEP_LABELS, ['name', 'describe', 'network', 'create'])
})
