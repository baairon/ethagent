import test from 'node:test'
import assert from 'node:assert/strict'
import {
  identityManagerReducer,
  createStepNumber,
  CREATE_STEP_LABELS,
  type Step,
} from '../../../src/identity/manager/reducer.js'

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
  nextRecords: { 'agent-registration[0x000100000101140000000000000000000000000000000000000001][1]': '1' },
  recordDiffs: [],
  txCount: 2,
  warnings: [],
}

test('identityManagerReducer: setStep replaces the current step', () => {
  let state: Step = { kind: 'menu' }
  state = identityManagerReducer(state, { type: 'setStep', step: { kind: 'create-name' } })
  assert.equal(state.kind, 'create-name')

  state = identityManagerReducer(state, { type: 'setStep', step: { kind: 'create-description', name: 'myagent' } })
  assert.equal(state.kind, 'create-description')

  state = identityManagerReducer(state, { type: 'setStep', step: { kind: 'create-network', name: 'myagent', description: 'test agent' } })
  assert.equal(state.kind, 'create-network')
})

test('identityManagerReducer: create back preserves local inputs', () => {
  const network: Step = { kind: 'create-network', name: 'pip', description: 'helper' }
  const previous = identityManagerReducer(network, { type: 'back', from: network })
  assert.equal(previous.kind, 'create-description')
  if (previous.kind === 'create-description') assert.equal(previous.name, 'pip')

  const signing: Step = { kind: 'create-signing', name: 'pip', description: 'helper', registry, custodyMode: 'simple' }
  const backToCustody = identityManagerReducer(signing, { type: 'back', from: signing })
  assert.equal(backToCustody.kind, 'create-custody')
  if (backToCustody.kind === 'create-custody') {
    assert.equal(backToCustody.name, 'pip')
    assert.equal(backToCustody.description, 'helper')
  }
})

test('identityManagerReducer: restore wallet and network back return to manager', () => {
  const wallet: Step = { kind: 'restore-wallet', purpose: 'switch' }
  assert.equal(identityManagerReducer(wallet, { type: 'back', from: wallet }).kind, 'menu')

  const network: Step = { kind: 'restore-network', ownerHandle: 'owner.eth', purpose: 'switch' }
  assert.equal(identityManagerReducer(network, { type: 'back', from: network }).kind, 'menu')
})

test('identityManagerReducer: restore search result steps back to network selection', () => {
  const notFound: Step = { kind: 'restore-not-found', ownerHandle: 'owner.eth', registry, reason: 'no-owner-or-operator', purpose: 'switch' }
  const backToNetwork = identityManagerReducer(notFound, { type: 'back', from: notFound })
  assert.equal(backToNetwork.kind, 'restore-network')
  if (backToNetwork.kind === 'restore-network') assert.equal(backToNetwork.ownerHandle, 'owner.eth')

  const select: Step = { kind: 'restore-select-token', ownerHandle: 'owner.eth', registry, candidates: [], purpose: 'restore' }
  assert.equal(identityManagerReducer(select, { type: 'back', from: select }).kind, 'restore-network')
})

test('identityManagerReducer: top-level identity subviews back to manager', () => {
  assert.equal(identityManagerReducer({ kind: 'details' }, { type: 'back', from: { kind: 'details' } }).kind, 'menu')
  assert.equal(identityManagerReducer({ kind: 'continuity-public' }, { type: 'back', from: { kind: 'continuity-public' } }).kind, 'menu')
  assert.equal(identityManagerReducer({ kind: 'continuity-private' }, { type: 'back', from: { kind: 'continuity-private' } }).kind, 'menu')
  assert.equal(identityManagerReducer({ kind: 'rebackup-confirm', back: { kind: 'menu' } }, { type: 'back', from: { kind: 'rebackup-confirm', back: { kind: 'menu' } } }).kind, 'menu')
  assert.equal(identityManagerReducer({ kind: 'recovery-refetch-confirm', back: { kind: 'menu' } }, { type: 'back', from: { kind: 'recovery-refetch-confirm', back: { kind: 'menu' } } }).kind, 'menu')
  assert.equal(identityManagerReducer({ kind: 'storage-credential' }, { type: 'back', from: { kind: 'storage-credential' } }).kind, 'menu')
})

test('identityManagerReducer: continuity overwrite confirm backs to its restore source', () => {
  const back: Step = { kind: 'restore-select-token', ownerHandle: 'owner.eth', registry, candidates: [], purpose: 'switch' }
  const confirm: Step = {
    kind: 'continuity-overwrite-confirm',
    action: 'restore',
    back,
    next: {
      kind: 'restore-fetching',
      cid: 'bafyrestore',
      apiUrl: 'https://uploads.pinata.cloud/v3/files',
      candidate: {
        chainId: 1,
        rpcUrl: 'https://example.com',
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: 1n,
        ownerAddress: identity.ownerAddress,
        tokenOwnerAddress: identity.ownerAddress,
        agentUri: 'ipfs://agent',
        metadataCid: 'bafymetadata',
        backup: { cid: 'bafyrestore' },
      } as never,
      purpose: 'switch',
    },
  }

  assert.deepEqual(identityManagerReducer(confirm, { type: 'back', from: confirm }), back)
})

test('identityManagerReducer: edit profile back preserves identity and registry', () => {
  const state: Step = { kind: 'edit-profile-description', identity, registry, name: 'pip', description: 'line one\nline two', imagePath: 'ipfs://icon.png', returnTo: { kind: 'continuity-public' } }
  const next = identityManagerReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-menu')
  if (next.kind === 'edit-profile-menu') {
    assert.equal(next.identity.address, identity.address)
    assert.equal(next.registry.chainId, registry.chainId)
    assert.equal(next.name, 'pip')
    assert.equal(next.description, 'line one\nline two')
    assert.equal(next.imagePath, 'ipfs://icon.png')
    assert.deepEqual(next.returnTo, { kind: 'continuity-public' })
  }
})

test('identityManagerReducer: every profile field steps back to the edit menu with drafts intact', () => {
  const drafts = {
    name: 'draft name',
    description: 'first line\nsecond line',
    imagePath: 'https://example.com/icon.webp',
    returnTo: { kind: 'continuity-public' } as Step,
  }
  const fields: Step[] = [
    { kind: 'edit-profile-name', identity, registry, ...drafts },
    { kind: 'edit-profile-description', identity, registry, ...drafts },
    { kind: 'edit-profile-image', identity, registry, ...drafts },
    { kind: 'edit-profile-review', identity, registry, ...drafts },
  ]
  for (const field of fields) {
    const menu = identityManagerReducer(field, { type: 'back', from: field })
    assert.equal(menu.kind, 'edit-profile-menu', `${field.kind} must return to the edit menu`)
    if (menu.kind !== 'edit-profile-menu') return
    assert.equal(menu.name, 'draft name')
    assert.equal(menu.description, 'first line\nsecond line')
    assert.equal(menu.imagePath, 'https://example.com/icon.webp')
    assert.deepEqual(menu.returnTo, { kind: 'continuity-public' })
  }
})

test('identityManagerReducer: storage credential sub-screens step back to the storage screen', () => {
  for (const kind of ['storage-credential-input', 'storage-credential-forget-confirm'] as const) {
    const from: Step = { kind }
    assert.deepEqual(identityManagerReducer(from, { type: 'back', from }), { kind: 'storage-credential' })
  }
  const storage: Step = { kind: 'storage-credential' }
  assert.deepEqual(identityManagerReducer(storage, { type: 'back', from: storage }), { kind: 'menu' })
})

test('identityManagerReducer: ens-records-tx back returns to edit-profile-ens', () => {
  const state: Step = {
    kind: 'ens-records-tx',
    identity,
    registry,
    fullName: 'ethagent.example.eth',
    records: { 'agent-registration[0x000100000101140000000000000000000000000000000000000001][1]': '1' },
    returnTo: { kind: 'menu' },
  }
  const next = identityManagerReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-ens')
  if (next.kind === 'edit-profile-ens') {
    assert.equal(next.identity.address, identity.address)
    assert.equal(next.registry.chainId, registry.chainId)
    assert.deepEqual(next.returnTo, { kind: 'menu' })
  }
})

test('identityManagerReducer: ENS setup tx back returns to advanced ENS setup', () => {
  const state: Step = {
    kind: 'ens-setup-registry-tx',
    identity,
    registry,
    setup: ensSetup,
    returnTo: { kind: 'continuity-public' },
  }
  const next = identityManagerReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'edit-profile-ens')
  if (next.kind === 'edit-profile-ens') {
    assert.equal(next.initialView, 'advanced')
    assert.deepEqual(next.returnTo, { kind: 'continuity-public' })
  }
})

test('identityManagerReducer: token transfer target backs to manager', () => {
  const state: Step = { kind: 'token-transfer-target', identity, registry }
  const next = identityManagerReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityManagerReducer: token transfer can return to advanced ENS setup', () => {
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

  assert.deepEqual(identityManagerReducer(target, { type: 'back', from: target }), returnTo)
  const signingBack = identityManagerReducer(signing, { type: 'back', from: signing })
  assert.equal(signingBack.kind, 'token-transfer-target')
  if (signingBack.kind === 'token-transfer-target') assert.deepEqual(signingBack.returnTo, returnTo)
  assert.deepEqual(identityManagerReducer(ready, { type: 'back', from: ready }), returnTo)
})

test('identityManagerReducer: backup approval returns to manager', () => {
  const state: Step = { kind: 'rebackup-signing', identity, registry }
  const next = identityManagerReducer(state, { type: 'back', from: state })
  assert.equal(next.kind, 'menu')
})

test('identityManagerReducer: error back returns the stored step', () => {
  const errorState: Step = {
    kind: 'error',
    error: { title: 'test' },
    back: { kind: 'restore-network', ownerHandle: 'owner.eth' },
  }
  const next = identityManagerReducer(errorState, { type: 'back', from: errorState })
  assert.equal(next.kind, 'restore-network')
})

test('identityManagerReducer: save-prompt back returns the stored step', () => {
  const state: Step = { kind: 'save-prompt', back: { kind: 'menu' } }
  const next = identityManagerReducer(state, { type: 'back', from: state })
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
