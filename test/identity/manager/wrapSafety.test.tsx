import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { Box } from 'ink'
import type { Address } from 'viem'
import { CustodyEditFlow } from '../../../src/identity/manager/custody/CustodyEditFlow.js'
import { TokenTransferSigningScreen } from '../../../src/identity/manager/transfer/TokenTransferScreens.js'
import { OperatorWalletsScreen } from '../../../src/identity/manager/ens/EnsOperatorWalletsScreen.js'
import { SimpleEnsIssueScreen } from '../../../src/identity/manager/ens/EnsEditReviewScreens.js'
import { EnsStatusBanner } from '../../../src/identity/manager/ens/EnsEditShared.js'
import { PinataJwtInput } from '../../../src/identity/manager/shared/components/PinataJwtInput.js'
import { IdentitySummary } from '../../../src/identity/manager/shared/components/IdentitySummary.js'
import { TextArea } from '../../../src/ui/TextArea.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'
import type { Erc8004RegistryConfig } from '../../../src/identity/registry/erc8004.js'

const RED_SGR = '38;2;232;184;184'
const DIM_SGR = '38;2;122;128;144'
const TEXT_SGR = '38;2;218;220;230'
const CONTENT_WIDTH = 42

const ESC = String.fromCharCode(27)
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g')
const stripAnsi = (value: string): string => value.replace(ANSI_RE, '')

const noop = (): void => {}

function frameLines(raw: string): { raw: string[]; plain: string[] } {
  const rawLines = raw.split('\n')
  return { raw: rawLines, plain: rawLines.map(stripAnsi) }
}

function assertBudget(plain: string[]): void {
  for (const line of plain) {
    assert.ok(line.trim().length <= CONTENT_WIDTH, `line exceeds the ${CONTENT_WIDTH}-col panel budget: ${JSON.stringify(line.trim())}`)
  }
}

function assertFragmentsColored(rawLines: string[], plainLines: string[], fragments: string[], sgr: string, what: string): void {
  let hits = 0
  for (let i = 0; i < plainLines.length; i += 1) {
    if (fragments.some(fragment => plainLines[i]!.includes(fragment))) {
      hits += 1
      assert.ok(rawLines[i]!.includes(sgr), `${what} line lost its color: ${JSON.stringify(plainLines[i])}`)
    }
  }
  assert.ok(hits > 0, `${what}: no line matched any expected fragment`)
}

const OWNER = '0x1111111111111111111111111111111111111111'
const TARGET = '0x2222222222222222222222222222222222222222'
const VAULT = '0x3333333333333333333333333333333333333333' as Address
const OP1 = '0x4444444444444444444444444444444444444444'
const OP2 = '0x5555555555555555555555555555555555555555'
const REGISTRY = '0x6666666666666666666666666666666666666666'
const LONG_HANDLE = 'my-agents.really-long-name.owner1.eth'

const registry = {
  chainId: 8453,
  rpcUrl: 'https://mainnet.base.org',
  identityRegistryAddress: REGISTRY,
} as Erc8004RegistryConfig

function makeIdentity(state: Record<string, unknown>): EthagentIdentity {
  return {
    address: OWNER,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'erc8004',
    ownerAddress: OWNER,
    connectedWallet: OWNER,
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: REGISTRY,
    agentId: '1',
    agentUri: 'ipfs://bafkreiexample',
    metadataCid: 'bafkreiexample',
    state: {
      version: 1,
      name: 'Agent One',
      description: 'Test agent.',
      createdAt: '2026-01-01T00:00:00.000Z',
      ownerAddress: OWNER,
      ...state,
    },
  }
}

test('custody screen keeps a wrapped ENS issue red and collapses multi-operator rows', () => {
  const identity = makeIdentity({
    ensName: 'agent.owner1.eth',
    ensValidation: { ok: false, reason: 'address-mismatch' },
    custodyMode: 'advanced',
    operatorVaultAddress: VAULT,
    approvedOperatorWallets: [
      { address: OP1, verifiedAt: '2026-05-17T01:35:13.390Z' },
      { address: OP2, verifiedAt: '2026-06-01T00:00:00.000Z' },
    ],
    activeOperatorAddress: OP1,
  })
  type CustodyEditStep = React.ComponentProps<typeof CustodyEditFlow>['step']
  const { lastFrame, unmount } = render(
    <CustodyEditFlow
      step={{ kind: 'custody-model', identity, registry } as CustodyEditStep}
      vaultAddress={VAULT}
      onSetStep={noop}
      onSwitchToAdvanced={noop}
      onSwitchToSimple={noop}
      onResumeAdvanced={noop}
      onManageOperatorWallets={noop}
      onPrepareTransfer={noop}
      onBack={noop}
    />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertFragmentsColored(raw, plain, ['agent.owner1.eth', 'resolving', 'expected wallet'], RED_SGR, 'ENS issue')
    const operatorLines = plain.filter(line => line.includes('authorized'))
    assert.equal(operatorLines.length, 1, 'the Operators row must stay one line')
    assert.ok(operatorLines[0]!.includes('2 authorized'), 'multi-operator value must collapse to a count')
  } finally {
    unmount()
  }
})

test('transfer signing screen wraps a long receiver handle without losing it or its color', () => {
  const identity = makeIdentity({ custodyMode: 'simple' })
  const { lastFrame, unmount } = render(
    <TokenTransferSigningScreen
      identity={identity}
      tokenNetworkLabel="base"
      targetHandle={LONG_HANDLE}
      targetAddress={TARGET}
      progress={null}
      walletSession={null}
      onCancel={noop}
    />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    const squashed = plain.join('').replace(/\s+/g, '')
    assert.ok(squashed.includes(LONG_HANDLE), 'the full receiver handle must survive wrapping untruncated')
    assertFragmentsColored(raw, plain, ['my-agents', 'agents.really', 'really-long', 'owner1.eth'], TEXT_SGR, 'receiver handle')
  } finally {
    unmount()
  }
})

test('operator wallets list keeps wrapped approval meta dim', () => {
  const identity = makeIdentity({
    custodyMode: 'advanced',
    operatorVaultAddress: VAULT,
    approvedOperatorWallets: [{ address: OP1, verifiedAt: '2026-05-17T01:35:13.390Z' }],
    activeOperatorAddress: OP1,
  })
  const { lastFrame, unmount } = render(
    <OperatorWalletsScreen
      identity={identity}
      registry={registry}
      walletSession={null}
      onSave={noop}
      onWalletReady={noop}
      onBack={noop}
    />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertFragmentsColored(raw, plain, ['approved', '2026-05-17'], DIM_SGR, 'operator meta')
    assert.ok(plain.some(line => line.includes('0x4444')), 'operator address must render')
  } finally {
    unmount()
  }
})

test('ens issue screen keeps the longest wrapped reason red', () => {
  type Validation = React.ComponentProps<typeof SimpleEnsIssueScreen>['validation']
  const { lastFrame, unmount } = render(
    <SimpleEnsIssueScreen
      fullName="agent.owner1.eth"
      validation={{ ok: false, reason: 'address-mismatch' } as Validation}
      onCreate={noop}
      onCheckAgain={noop}
      onChange={noop}
      onBack={noop}
    />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertFragmentsColored(raw, plain, ['resolving', 'expected wallet'], RED_SGR, 'validation reason')
  } finally {
    unmount()
  }
})

test('ens status banner keeps its wrapped not-linked copy dim', () => {
  const identity = makeIdentity({})
  const { lastFrame, unmount } = render(
    <Box width={CONTENT_WIDTH}>
      <EnsStatusBanner identity={identity} noRootEnsName />
    </Box>,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertFragmentsColored(raw, plain, ['Not Linked', 'ENS name.'], DIM_SGR, 'status banner')
  } finally {
    unmount()
  }
})

test('compact summary strip stays one styled line on mainnet with a long name', () => {
  const identity: EthagentIdentity = {
    ...makeIdentity({ name: 'longer-agent-name1', custodyMode: 'simple' }),
    chainId: 1,
    agentId: '45744',
  }
  const { lastFrame, unmount } = render(
    <Box width={CONTENT_WIDTH}>
      <IdentitySummary identity={identity} compact />
    </Box>,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    const stripLines = plain.filter(line => line.trim().length > 0)
    assert.equal(stripLines.length, 1, `the compact strip must render as exactly one line, got ${JSON.stringify(stripLines)}`)
    assert.ok(stripLines[0]!.includes('…'), 'the long name must truncate with an ellipsis')
    assert.ok(stripLines[0]!.includes('#45744'), 'the token segment must survive')
    assert.ok(stripLines[0]!.includes('ethereum mainnet'), 'the network segment must survive')
    for (let i = 0; i < plain.length; i += 1) {
      if (plain[i]!.trim().length === 0) continue
      assert.ok(raw[i]!.includes('38;2;'), `compact strip line lost all styling: ${JSON.stringify(plain[i])}`)
    }
  } finally {
    unmount()
  }
})

test('textarea renders a long edited line as budgeted rows that keep their color', () => {
  const value = 'a very long description line that keeps on going well past forty columns'
  const { lastFrame, unmount } = render(
    <TextArea initialValue={value} onSubmit={noop} />,
  )
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    const contentLines = plain.filter(line => line.trim().length > 0)
    assert.ok(contentLines.length >= 2, 'the 74-char line must span at least two visual rows')
    for (const line of plain) {
      assert.ok(line.length <= CONTENT_WIDTH, `textarea row exceeds budget: ${JSON.stringify(line)}`)
    }
    const squashed = plain.join('').replace(/[>\s]+/g, '')
    assert.ok(squashed.includes(value.replace(/\s+/g, '')), 'the full line must survive chunking untruncated')
    for (let i = 0; i < plain.length; i += 1) {
      if (!/[a-z]/.test(plain[i]!)) continue
      assert.ok(raw[i]!.includes(TEXT_SGR), `textarea row lost the text color: ${JSON.stringify(plain[i])}`)
    }
    assert.ok(raw.some(line => line.includes('48;2;240;238;232')), 'the cursor block must render with its background')
  } finally {
    unmount()
  }
})

test('pinata storage prompt keeps its address on one intact line', () => {
  const { lastFrame, unmount } = render(
    <PinataJwtInput inputKey="wrap-safety" footer={null} onSubmit={noop} onCancel={noop} />,
  )
  try {
    const { plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assert.ok(
      plain.some(line => line.trim() === 'app.pinata.cloud/developers/api-keys'),
      'the API keys address must sit intact on its own line',
    )
  } finally {
    unmount()
  }
})
