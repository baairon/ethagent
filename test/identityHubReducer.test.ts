import test from 'node:test'
import assert from 'node:assert/strict'
import {
  identityHubReducer,
  createStepNumber,
  CREATE_STEP_LABELS,
  type Step,
} from '../src/identity/identityHubReducer.js'

test('identityHubReducer: startCreate without identity goes to create-name', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, { type: 'startCreate', hasIdentity: false })
  assert.equal(next.kind, 'create-name')
})

test('identityHubReducer: startCreate with identity goes to replace-confirm', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, { type: 'startCreate', hasIdentity: true })
  assert.equal(next.kind, 'replace-confirm')
})

test('identityHubReducer: confirmReplace goes to create-name', () => {
  const state: Step = { kind: 'replace-confirm', next: 'create' }
  const next = identityHubReducer(state, { type: 'confirmReplace' })
  assert.equal(next.kind, 'create-name')
})

test('identityHubReducer: cancelReplace goes to menu', () => {
  const state: Step = { kind: 'replace-confirm', next: 'create' }
  const next = identityHubReducer(state, { type: 'cancelReplace' })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: nameSubmitted goes to create-description', () => {
  const state: Step = { kind: 'create-name' }
  const next = identityHubReducer(state, { type: 'nameSubmitted', name: 'myagent' })
  assert.equal(next.kind, 'create-description')
  if (next.kind === 'create-description') {
    assert.equal(next.name, 'myagent')
  }
})

test('identityHubReducer: descriptionSubmitted goes to create-network so the user picks a chain inline', () => {
  const state: Step = { kind: 'create-description', name: 'myagent' }
  const next = identityHubReducer(state, { type: 'descriptionSubmitted', name: 'myagent', description: 'test agent' })
  assert.equal(next.kind, 'create-network')
  if (next.kind === 'create-network') {
    assert.equal(next.name, 'myagent')
    assert.equal(next.description, 'test agent')
  }
})

test('identityHubReducer: startRestore goes to restore-owner', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, { type: 'startRestore' })
  assert.equal(next.kind, 'restore-owner')
})

test('identityHubReducer: selectNetwork goes to network', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, { type: 'selectNetwork' })
  assert.equal(next.kind, 'network')
})

test('identityHubReducer: networkSelected returns to details', () => {
  const state: Step = { kind: 'network' }
  const next = identityHubReducer(state, { type: 'networkSelected', network: 'arbitrum' })
  assert.equal(next.kind, 'details')
})

test('identityHubReducer: openDetails goes to details', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, { type: 'openDetails' })
  assert.equal(next.kind, 'details')
})

test('identityHubReducer: startForgetIdentity opens the local wipe confirmation', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, { type: 'startForgetIdentity' })
  assert.equal(next.kind, 'forget-confirm')
})

test('identityHubReducer: cancelForgetIdentity returns to settings', () => {
  const state: Step = { kind: 'forget-confirm' }
  const next = identityHubReducer(state, { type: 'cancelForgetIdentity' })
  assert.equal(next.kind, 'details')
})

test('identityHubReducer: openCopyPicker flips copyPicker on the details step', () => {
  const state: Step = { kind: 'details' }
  const next = identityHubReducer(state, { type: 'openCopyPicker' })
  assert.equal(next.kind, 'details')
  if (next.kind === 'details') assert.equal(next.copyPicker, true)
})

test('identityHubReducer: closeCopyPicker drops the picker flag', () => {
  const state: Step = { kind: 'details', copyPicker: true }
  const next = identityHubReducer(state, { type: 'closeCopyPicker' })
  assert.equal(next.kind, 'details')
  if (next.kind === 'details') assert.equal(next.copyPicker, undefined)
})

test('identityHubReducer: error action stores error with back step', () => {
  const state: Step = { kind: 'menu' }
  const next = identityHubReducer(state, {
    type: 'error',
    error: { title: 'test error', detail: 'some detail' },
    back: { kind: 'restore-owner' },
  })
  assert.equal(next.kind, 'error')
  if (next.kind === 'error') {
    assert.equal(next.error.title, 'test error')
    assert.equal(next.back.kind, 'restore-owner')
  }
})

test('identityHubReducer: back from create-name returns to menu', () => {
  const state: Step = { kind: 'create-name' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: back from create-description returns to create-name', () => {
  const state: Step = { kind: 'create-description', name: 'test' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'create-name')
})

test('identityHubReducer: back from create-network returns to create-description preserving name', () => {
  const state: Step = { kind: 'create-network', name: 'pip', description: 'helper' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'create-description')
  if (next.kind === 'create-description') assert.equal(next.name, 'pip')
})

test('identityHubReducer: back from restore-network returns to restore-owner preserving purpose', () => {
  const state: Step = { kind: 'restore-network', ownerHandle: 'pip.eth', purpose: 'switch' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'restore-owner')
  if (next.kind === 'restore-owner') assert.equal(next.purpose, 'switch')
})

test('identityHubReducer: back from restore-wallet returns to restore-owner preserving purpose', () => {
  const state: Step = { kind: 'restore-wallet', purpose: 'restore' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'restore-owner')
  if (next.kind === 'restore-owner') assert.equal(next.purpose, 'restore')
})

test('identityHubReducer: back from network returns to details', () => {
  const state: Step = { kind: 'network' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'details')
})

test('identityHubReducer: back from restore-select-token returns to menu', () => {
  const state: Step = {
    kind: 'restore-select-token',
    ownerHandle: 'owner.eth',
    registry: { chainId: 1, rpcUrl: 'https://example.com', identityRegistryAddress: '0x0000000000000000000000000000000000000001' as any },
    candidates: [],
    purpose: 'restore',
  }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: back from restore-token-id returns to menu', () => {
  const state: Step = {
    kind: 'restore-token-id',
    ownerHandle: 'owner.eth',
    registry: { chainId: 1, rpcUrl: 'https://example.com', identityRegistryAddress: '0x0000000000000000000000000000000000000001' as any },
    purpose: 'switch',
  }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: back from details with copyPicker returns to fresh details', () => {
  const state: Step = { kind: 'details', copyPicker: true }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'details')
  if (next.kind === 'details') assert.equal(next.copyPicker, undefined)
})

test('identityHubReducer: back from a plain details step returns to menu', () => {
  const state: Step = { kind: 'details' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityHubReducer: back from forget confirmation returns to settings', () => {
  const state: Step = { kind: 'forget-confirm' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'details')
})

test('identityHubReducer: back from storage credential screens returns to settings', () => {
  const states: Step[] = [
    { kind: 'storage-credential' },
    { kind: 'storage-credential-input' },
    { kind: 'storage-credential-forget-confirm' },
  ]
  for (const state of states) {
    const next = identityHubReducer(state, { type: 'back', from: state })
    assert.equal(next.kind, 'details', `expected ${state.kind} to back out to settings`)
  }
})

test('identityHubReducer: back from snapshot import/export screens returns to settings', () => {
  const identity = { address: '0x0000000000000000000000000000000000000001', createdAt: new Date(0).toISOString(), agentId: '1' }
  const states: Step[] = [
    { kind: 'snapshot-exporting', identity },
    { kind: 'snapshot-import-path' },
    { kind: 'snapshot-importing', source: 'agent.json' },
  ]
  for (const state of states) {
    const next = identityHubReducer(state, { type: 'back', from: state })
    assert.equal(next.kind, 'details', `expected ${state.kind} to back out to settings`)
  }
})

test('identityHubReducer: back from edit-profile-name returns to details', () => {
  const baseRegistry = { chainId: 1, rpcUrl: 'https://example.com', identityRegistryAddress: '0x0000000000000000000000000000000000000001' as any }
  const identity = { address: '0x0000000000000000000000000000000000000001', createdAt: new Date(0).toISOString(), agentId: '1' }
  const state: Step = { kind: 'edit-profile-name', identity, registry: baseRegistry }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'details')
})

test('identityHubReducer: back from edit-profile-description returns to edit-profile-name preserving identity', () => {
  const baseRegistry = { chainId: 1, rpcUrl: 'https://example.com', identityRegistryAddress: '0x0000000000000000000000000000000000000001' as any }
  const identity = { address: '0x0000000000000000000000000000000000000001', createdAt: new Date(0).toISOString(), agentId: '1' }
  const state: Step = { kind: 'edit-profile-description', identity, registry: baseRegistry, name: 'pip' }
  const next = identityHubReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-name')
  if (next.kind === 'edit-profile-name') {
    assert.equal(next.identity.address, identity.address)
    assert.equal(next.registry.chainId, baseRegistry.chainId)
  }
})

test('identityHubReducer: back from any rebackup step returns to menu', () => {
  const baseRegistry = { chainId: 1, rpcUrl: 'https://example.com', identityRegistryAddress: '0x0000000000000000000000000000000000000001' as any }
  const identity = { address: '0x0000000000000000000000000000000000000001', createdAt: new Date(0).toISOString(), agentId: '1' }
  const states: Step[] = [
    { kind: 'rebackup-signing', identity, registry: baseRegistry },
    { kind: 'rebackup-pinning', identity, registry: baseRegistry, wallet: { account: identity.address as any, signature: '0x' as any, message: 'challenge' }, apiUrl: 'https://uploads.pinata.cloud/v3/files' },
    { kind: 'rebackup-storage', identity, registry: baseRegistry },
  ]
  for (const state of states) {
    const next = identityHubReducer(state, { type: 'back', from: state })
    assert.equal(next.kind, 'menu', `expected ${state.kind} to back out to menu`)
  }
})

test('identityHubReducer: back from error returns the back step', () => {
  const errorState: Step = {
    kind: 'error',
    error: { title: 'test' },
    back: { kind: 'restore-owner' },
  }
  const next = identityHubReducer(errorState, { type: 'back', from: errorState })
  assert.equal(next.kind, 'restore-owner')
})

test('identityHubReducer: preflightResolved passes through step', () => {
  const state: Step = { kind: 'menu' }
  const target: Step = { kind: 'create-signing', name: 'test', description: 'desc', registry: { chainId: 1, rpcUrl: 'https://example.com', identityRegistryAddress: '0x0000000000000000000000000000000000000001' as any } }
  const next = identityHubReducer(state, { type: 'preflightResolved', step: target })
  assert.equal(next.kind, 'create-signing')
})

test('createStepNumber: create-name is step 1, create-description is step 2', () => {
  assert.equal(createStepNumber({ kind: 'create-name' }), 1)
  assert.equal(createStepNumber({ kind: 'create-description', name: 'test' }), 2)
})

test('createStepNumber: storage and signing are step 3', () => {
  assert.equal(createStepNumber({ kind: 'create-storage', name: 'test', description: 'desc', registry: {} as any }), 3)
  assert.equal(createStepNumber({ kind: 'create-signing', name: 'test', description: 'desc', registry: {} as any }), 3)
})

test('createStepNumber: registering is step 4', () => {
  assert.equal(createStepNumber({ kind: 'create-registering', name: 'test', description: 'desc', registry: {} as any, ownerAddress: '0x0' as any, agentUri: '', metadataCid: '', metadataPin: { cid: '', pinVerified: true, provider: 'ipfs' }, backup: {} as any, state: {} }), 4)
})

test('createStepNumber returns 0 for non-create steps', () => {
  assert.equal(createStepNumber({ kind: 'menu' }), 0)
  assert.equal(createStepNumber({ kind: 'network' }), 0)
  assert.equal(createStepNumber({ kind: 'details' }), 0)
})

test('CREATE_STEP_LABELS has exactly 4 labeled steps', () => {
  assert.equal(CREATE_STEP_LABELS.length, 4)
  assert.deepEqual(CREATE_STEP_LABELS, ['name', 'describe', 'connect', 'register'])
})
