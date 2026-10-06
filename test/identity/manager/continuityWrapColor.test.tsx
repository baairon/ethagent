import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { RecoveryConfirmScreen } from '../../../src/identity/manager/continuity/RecoveryConfirmScreen.js'
import { SavePromptScreen } from '../../../src/identity/manager/continuity/SavePromptScreen.js'
import { DetailsScreen } from '../../../src/identity/manager/shared/components/DetailsScreen.js'
import { TerminalSizeProvider } from '../../../src/ui/layout.js'
import type { ContinuityWorkingTreeStatus } from '../../../src/identity/continuity/storage.js'
import type { EthagentConfig, EthagentIdentity } from '../../../src/storage/config.js'

const RED_SGR = '38;2;232;184;184'
const NARROW_COLUMNS = 54
const CONTENT_WIDTH = 42

const ESC = String.fromCharCode(27)
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g')

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

function renderNarrow(node: React.ReactElement) {
  return render(<TerminalSizeProvider columns={NARROW_COLUMNS}>{node}</TerminalSizeProvider>)
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

const exactStatus: ContinuityWorkingTreeStatus = {
  ...dirtyStatus,
  changes: {
    files: [
      { path: 'MEMORY.md', change: 'modified', added: 2, removed: 1 },
      { path: 'skills/canvas/SKILL.md', change: 'modified', added: 1, removed: 1 },
      { path: 'skills/browser/SKILL.md', change: 'added', added: 9, removed: 0 },
      { path: 'agent-card.json', change: 'modified', added: 1, removed: 1 },
    ],
    skills: [{ name: 'browser', change: 'added' }, { name: 'canvas', change: 'modified' }],
  },
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

function assertBudget(plain: string[]): void {
  for (const line of plain) {
    assert.ok(line.trim().length <= CONTENT_WIDTH, `line exceeds the ${CONTENT_WIDTH}-col panel budget: ${JSON.stringify(line.trim())}`)
    assert.ok(!line.includes('…'), `nothing may be elided: ${JSON.stringify(line.trim())}`)
  }
}

function changeRow(plain: string[], name: string): number {
  return plain.findIndex(line => line.trim().startsWith(`${name} `))
}

test('save confirm names every changed file red on its own row', () => {
  const { lastFrame, unmount } = renderNarrow(
    <RecoveryConfirmScreen mode="publish" workingStatus={dirtyStatus} footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assert.ok(plain.some(line => line.trim() === 'Changes since your last snapshot'), 'the heading must render')
    for (const name of ['SOUL.md', 'MEMORY.md', 'Skills']) {
      const idx = changeRow(plain, name)
      assert.notEqual(idx, -1, `${name} must have its own row`)
      assert.ok(raw[idx]!.includes(RED_SGR), `${name} must carry the red SGR`)
    }
    assertBudget(plain)
  } finally {
    unmount()
  }
})

test('save confirm names the exact skills when the latest snapshot is cached', () => {
  const { lastFrame, unmount } = renderNarrow(
    <RecoveryConfirmScreen mode="publish" workingStatus={exactStatus} footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { plain } = frameLines(lastFrame() ?? '')
    assert.ok(plain[changeRow(plain, 'MEMORY.md')]!.includes('Edited'))
    assert.ok(plain[changeRow(plain, 'browser')]!.includes('New skill'))
    assert.ok(plain[changeRow(plain, 'canvas')]!.includes('Skill edited'))
    assert.equal(changeRow(plain, 'Skills'), -1, 'the generic Skills row must not appear')
    assert.equal(changeRow(plain, 'Agent Card'), -1, 'the derived card hides behind the skill that changed it')
    assertBudget(plain)
  } finally {
    unmount()
  }
})

test('overwrite confirm keeps every warning line red across wraps and defaults to Back', () => {
  const { lastFrame, unmount } = renderNarrow(
    <RecoveryConfirmScreen mode="restore" workingStatus={dirtyStatus} pendingPublish footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assert.ok(plain.some(line => line.trim() === 'These unsaved changes will be lost'), 'the heading must render')
    for (let i = 0; i < plain.length; i += 1) {
      const text = plain[i]!.trim()
      if (text.includes('has not reached') || text.includes('replaced too')) {
        assert.ok(raw[i]!.includes(RED_SGR), `warning line must stay red even when wrapped: ${JSON.stringify(text)}`)
      }
    }
    assert.ok(plain.some(line => line.trim() === '❯ Back'), 'a destructive confirm must default to Back')
    assertBudget(plain)
  } finally {
    unmount()
  }
})

test('save confirm falls back to a red sentence when no files enumerate', () => {
  const { lastFrame, unmount } = renderNarrow(
    <RecoveryConfirmScreen mode="publish" workingStatus={dirtyWithoutFileDetail} footer={null} onConfirm={() => {}} onBack={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const idx = plain.findIndex(line => line.includes('Local files differ'))
    assert.notEqual(idx, -1, 'the fallback sentence must render')
    assert.ok(raw[idx]!.includes(RED_SGR), 'the fallback sentence must carry the red SGR')
    assert.ok(!plain.some(line => line.trim() === 'Changes since your last snapshot'), 'no empty heading')
    assertBudget(plain)
  } finally {
    unmount()
  }
})

test('save prompt lists the unsaved changes', () => {
  const { lastFrame, unmount } = renderNarrow(
    <SavePromptScreen workingStatus={exactStatus} footer={null} onSelect={() => {}} onCancel={() => {}} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    for (const name of ['MEMORY.md', 'browser', 'canvas']) {
      const idx = changeRow(plain, name)
      assert.notEqual(idx, -1, `${name} must be listed`)
      assert.ok(raw[idx]!.includes(RED_SGR), `${name} must carry the red SGR`)
    }
    assertBudget(plain)
  } finally {
    unmount()
  }
})

test('token values shows a pending publish as one line inside the panel', () => {
  const { lastFrame, unmount } = renderNarrow(
    <DetailsScreen identity={pendingIdentity} config={pendingConfig} footer={null} onCopy={() => {}} onBack={() => {}} />,
  )
  try {
    const { plain } = frameLines(lastFrame() ?? '')
    const idx = plain.findIndex(line => line.includes('not yet onchain'))
    assert.notEqual(idx, -1, 'the pending value must render')
    assert.ok(plain[idx]!.includes('Pending'), 'the pending value must share its line with the label')
    for (const line of plain) assert.ok(line.trim().length <= CONTENT_WIDTH, `line exceeds the panel budget: ${JSON.stringify(line.trim())}`)
  } finally {
    unmount()
  }
})
