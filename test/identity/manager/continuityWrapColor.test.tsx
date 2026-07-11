import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { Box } from 'ink'
import { RecoveryConfirmScreen } from '../../../src/identity/manager/continuity/RecoveryConfirmScreen.js'
import { SavePromptScreen } from '../../../src/identity/manager/continuity/SavePromptScreen.js'
import { IdentitySummary } from '../../../src/identity/manager/shared/components/IdentitySummary.js'
import type { ContinuityWorkingTreeStatus } from '../../../src/identity/continuity/storage.js'
import type { EthagentConfig, EthagentIdentity } from '../../../src/storage/config.js'

const RED_SGR = '38;2;232;184;184'
const DIM_SGR = '38;2;122;128;144'
const FILE_LIST = 'SOUL.md, MEMORY.md, Skills'
const CONTENT_WIDTH = 42

const ESC = String.fromCharCode(27)
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g')

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

function frameLines(raw: string): { raw: string[]; plain: string[] } {
  const rawLines = raw.split('\n')
  return { raw: rawLines, plain: rawLines.map(stripAnsi) }
}

const publishedHashes = { 'SOUL.md': 's0', 'MEMORY.md': 'm0', 'agent-card.json': 'c0', 'private-skills': 'k0' }

const dirtyStatus: ContinuityWorkingTreeStatus = {
  ready: true,
  localChangedAfterBackup: true,
  publishState: 'local-changes',
  localContentHashes: { 'SOUL.md': 's1', 'MEMORY.md': 'm1', 'agent-card.json': 'c1', 'private-skills': 'k1' },
  publishedContentHashes: publishedHashes,
}

const dirtyWithoutFileDetail: ContinuityWorkingTreeStatus = {
  ready: true,
  localChangedAfterBackup: true,
  publishState: 'local-changes',
  localContentHashes: publishedHashes,
  publishedContentHashes: publishedHashes,
}

const OWNER = '0x1111111111111111111111111111111111111111'
const REGISTRY = '0x2222222222222222222222222222222222222222'

const pendingIdentity: EthagentIdentity = {
  address: OWNER,
  createdAt: '2026-01-01T00:00:00.000Z',
  source: 'erc8004',
  ownerAddress: OWNER,
  connectedWallet: OWNER,
  chainId: 8453,
  rpcUrl: 'https://mainnet.base.org',
  identityRegistryAddress: REGISTRY,
  agentId: '1',
  agentUri: 'ipfs://bafkreinewpointer',
  metadataCid: 'bafkreinewpointer',
  state: {
    version: 1,
    name: 'Agent One',
    description: 'Test agent.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ownerAddress: OWNER,
    custodyMode: 'simple',
  },
  backup: {
    cid: 'bafybeibackup',
    createdAt: '2026-01-02T00:00:00.000Z',
    envelopeVersion: 'ethagent-continuity-snapshot-v1',
    ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
    status: 'pinned',
    metadataCid: 'bafkreioldpointer',
  },
}

const pendingConfig: EthagentConfig = {
  version: 2,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  identity: pendingIdentity,
  erc8004: { chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY },
  selectedNetwork: 'base',
}

function assertNoBrokenList(plain: string[]): void {
  for (const line of plain) {
    assert.equal(line.trimEnd().endsWith('SOUL.md,'), false, `file list must not wrap mid-list: ${JSON.stringify(line)}`)
    assert.ok(line.trim().length <= CONTENT_WIDTH, `line exceeds the ${CONTENT_WIDTH}-col panel budget: ${JSON.stringify(line.trim())}`)
  }
}

test('save confirm renders the changed-file list red and unbroken', () => {
  const { lastFrame, unmount } = render(
    <RecoveryConfirmScreen mode="publish" workingStatus={dirtyStatus} footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const listIdx = plain.findIndex(line => line.trim() === FILE_LIST)
    assert.notEqual(listIdx, -1, 'the full file list must sit intact on one line')
    assert.ok(raw[listIdx]!.includes(RED_SGR), 'the file list line must carry the red SGR')
    assert.ok(plain.some(line => line.trim() === 'Local changes detected:'), 'the label line must render')
    assertNoBrokenList(plain)
  } finally {
    unmount()
  }
})

test('overwrite confirm keeps every warning line red across wraps', () => {
  const { lastFrame, unmount } = render(
    <RecoveryConfirmScreen mode="restore" workingStatus={dirtyStatus} pendingPublish footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const listIdx = plain.findIndex(line => line.trim() === FILE_LIST)
    assert.notEqual(listIdx, -1, 'the full file list must sit intact on one line')
    assert.ok(raw[listIdx]!.includes(RED_SGR), 'the file list line must carry the red SGR')
    assert.ok(plain.some(line => line.trim() === 'Unsaved local changes detected:'), 'the label line must render')
    for (let i = 0; i < plain.length; i += 1) {
      const text = plain[i]!.trim()
      if (text.length === 0) continue
      if (text.includes('Continuing replaces') || text.includes('restored snapshot') || text.includes('also ahead of onchain')) {
        assert.ok(raw[i]!.includes(RED_SGR), `warning line must stay red even when wrapped: ${JSON.stringify(text)}`)
      }
    }
    assertNoBrokenList(plain)
  } finally {
    unmount()
  }
})

test('save confirm falls back to a red differ sentence when no files enumerate', () => {
  const { lastFrame, unmount } = render(
    <RecoveryConfirmScreen mode="publish" workingStatus={dirtyWithoutFileDetail} footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const idx = plain.findIndex(line => line.trim() === 'local files differ from saved snapshot')
    assert.notEqual(idx, -1, 'the fallback sentence must sit intact on one line')
    assert.ok(raw[idx]!.includes(RED_SGR), 'the fallback sentence must carry the red SGR')
    assertNoBrokenList(plain)
  } finally {
    unmount()
  }
})

test('save prompt keeps the changed list on one red line', () => {
  const { lastFrame, unmount } = render(
    <SavePromptScreen workingStatus={dirtyStatus} footer={null} onSelect={() => {}} onCancel={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const idx = plain.findIndex(line => line.trim() === `Changed: ${FILE_LIST}`)
    assert.notEqual(idx, -1, 'the changed list must sit intact on one line with its label')
    assert.ok(raw[idx]!.includes(RED_SGR), 'the changed list must carry the red SGR')
    assertNoBrokenList(plain)
  } finally {
    unmount()
  }
})

test('identity summary pending cell stays one dim line inside the panel', () => {
  const { lastFrame, unmount } = render(
    <Box width={CONTENT_WIDTH}>
      <IdentitySummary identity={pendingIdentity} config={pendingConfig} hideHeader />
    </Box>,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const idx = plain.findIndex(line => line.includes('local ahead of onchain'))
    assert.notEqual(idx, -1, 'the pending value must render')
    assert.ok(plain[idx]!.includes('Pending'), 'the pending value must share its line with the label')
    assert.ok(plain[idx]!.trim().length <= CONTENT_WIDTH, 'the pending line must fit the panel budget')
    assert.ok(raw[idx]!.includes(DIM_SGR), 'the pending line must carry the dim SGR')
    assert.equal(plain.some(line => line.trim() === 'rotates pointer'), false, 'no orphaned wrap fragment may render')
  } finally {
    unmount()
  }
})
