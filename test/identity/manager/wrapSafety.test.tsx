import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Address } from 'viem'
import { CustodyEditFlow } from '../../../src/identity/manager/custody/CustodyEditFlow.js'
import { TokenTransferSigningScreen } from '../../../src/identity/manager/transfer/TokenTransferScreens.js'
import { OperatorWalletsScreen } from '../../../src/identity/manager/ens/EnsOperatorWalletsScreen.js'
import { renderEnsMaintenancePhase } from '../../../src/identity/manager/ens/EnsEditMaintenanceScreens.js'
import { SubdomainEntry } from '../../../src/identity/manager/ens/EnsEditShared.js'
import { PinataJwtInput } from '../../../src/identity/manager/shared/components/PinataJwtInput.js'
import { IdentitySummary } from '../../../src/identity/manager/shared/components/IdentitySummary.js'
import { TextArea } from '../../../src/ui/TextArea.js'
import { TerminalSizeProvider } from '../../../src/ui/layout.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'
import type { Erc8004RegistryConfig } from '../../../src/identity/registry/erc8004.js'

const RED_SGR = '38;2;232;184;184'
const TEXT_SGR = '38;2;218;220;230'
const NARROW_COLUMNS = 54
const CONTENT_WIDTH = 42

const ESC = String.fromCharCode(27)
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*m', 'g')
const stripAnsi = (value: string): string => value.replace(ANSI_RE, '')

const noop = (): void => {}

function renderNarrow(node: React.ReactElement) {
  return render(<TerminalSizeProvider columns={NARROW_COLUMNS}>{node}</TerminalSizeProvider>)
}

function frameLines(raw: string): { raw: string[]; plain: string[] } {
  const rawLines = raw.split('\n')
  return { raw: rawLines, plain: rawLines.map(stripAnsi) }
}

function assertBudget(plain: string[]): void {
  for (const line of plain) {
    assert.ok(line.trim().length <= CONTENT_WIDTH, `line exceeds the ${CONTENT_WIDTH}-col panel budget: ${JSON.stringify(line.trim())}`)
  }
}

function assertNoLeadingSpaceWraps(plain: string[]): void {
  for (let i = 1; i < plain.length; i += 1) {
    const line = plain[i]!
    const prev = plain[i - 1]!
    if (!line.trim() || !prev.trim()) continue
    const indent = line.length - line.trimStart().length
    const prevIndent = prev.length - prev.trimStart().length
    assert.notEqual(indent, prevIndent + 1, `wrapped line starts with a stray space: ${JSON.stringify(line)}`)
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
  const { lastFrame, unmount } = renderNarrow(
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
    assertNoLeadingSpaceWraps(plain)
    assertFragmentsColored(raw, plain, ['agent.owner1.eth', 'point to', 'owner wallet)'], RED_SGR, 'ENS issue')
    const operatorLines = plain.filter(line => line.includes('authorized'))
    assert.equal(operatorLines.length, 1, 'the Operators row must stay one line')
    assert.ok(operatorLines[0]!.includes('2 authorized'), 'multi-operator value must collapse to a count')
  } finally {
    unmount()
  }
})

test('transfer signing screen wraps a long receiver handle without losing it or its color', () => {
  const identity = makeIdentity({ custodyMode: 'simple' })
  const { lastFrame, unmount } = renderNarrow(
    <TokenTransferSigningScreen
      identity={identity}
      tokenNetworkLabel="Base"
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
    assertFragmentsColored(raw, plain, ['my-agents', 'really-long'], TEXT_SGR, 'receiver handle')
  } finally {
    unmount()
  }
})

test('operator wallets list shows each operator with its approval date', () => {
  const identity = makeIdentity({
    custodyMode: 'advanced',
    operatorVaultAddress: VAULT,
    approvedOperatorWallets: [{ address: OP1, verifiedAt: '2026-05-17T01:35:13.390Z' }],
    activeOperatorAddress: OP1,
  })
  const { lastFrame, unmount } = renderNarrow(
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
    const { plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertNoLeadingSpaceWraps(plain)
    const row = plain.find(line => line.includes('0x4444'))
    assert.ok(row, 'operator address must render')
    assert.ok(plain.join(' ').includes('approved 2026-05-17'), 'approval date must render')
    assert.ok(!plain.some(line => line.includes('Navigation')), 'no single-item navigation section')
  } finally {
    unmount()
  }
})

test('ens home keeps a wrapped problem red and offers Check Again', () => {
  const identity = makeIdentity({ ensName: 'agent.owner1.eth', ensValidation: { ok: false, reason: 'address-mismatch' } })
  const screen = renderEnsMaintenancePhase({
    phase: { kind: 'mode-select' },
    identity,
    currentEnsName: 'agent.owner1.eth',
    savedCustodyMode: 'simple',
    savedOwnerAddress: OWNER,
    validationError: null,
    ownerAddress: OWNER as Address,
    operatorWalletSession: null,
    setOperatorWalletSession: noop,
    setPhase: noop,
    runDiscovery: noop,
    runCheckAgain: noop,
    runUnlinkEnsLoading: noop,
    onBack: noop,
    onEnsUnlink: noop,
    onEnsRecordsUpdate: noop,
  })
  const { lastFrame, unmount } = renderNarrow(<>{screen}</>)
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertNoLeadingSpaceWraps(plain)
    assertFragmentsColored(raw, plain, ['point to', 'owner wallet.'], RED_SGR, 'ENS problem')
    assert.ok(plain.some(line => line.includes('Check Again')), 'an ENS problem offers Check Again')
  } finally {
    unmount()
  }
})

test('subdomain entry previews the full name and the wallet it points to', () => {
  const { lastFrame, unmount } = renderNarrow(
    <SubdomainEntry parent="owner1.eth" pointsTo={OWNER as Address} initialValue="agent" onConfirm={noop} onBack={noop} />,
  )
  try {
    const { plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assert.ok(plain.some(line => line.includes('agent.owner1.eth')), 'the full name preview must render')
    assert.ok(plain.some(line => line.includes('0x1111…1111')), 'the target wallet must render')
  } finally {
    unmount()
  }
})

test('identity header shows the whole name, then token and network', () => {
  const identity: EthagentIdentity = {
    ...makeIdentity({ name: 'A rather long agent name that keeps going', ensName: 'agent.owner1.eth', ensValidation: { ok: true } }),
    chainId: 1,
    agentId: '45744',
  }
  const { lastFrame, unmount } = renderNarrow(<IdentitySummary identity={identity} />)
  try {
    const { raw, plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assertNoLeadingSpaceWraps(plain)
    const text = plain.map(line => line.trim()).filter(Boolean).join(' ')
    assert.ok(!text.includes('…'), 'the header must not elide anything')
    const order = ['A rather long agent name that keeps going', '#45744', 'Ethereum Mainnet'].map(part => text.indexOf(part))
    assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!)), 'name, token, and network must appear in order')
    assert.ok(!text.includes('agent.owner1.eth'), 'the ENS name belongs on the ENS screen, not the header')
    for (let i = 0; i < plain.length; i += 1) {
      if (plain[i]!.trim().length === 0) continue
      assert.ok(raw[i]!.includes('38;2;'), `header line lost all styling: ${JSON.stringify(plain[i])}`)
    }
  } finally {
    unmount()
  }
})

test('identity header never repeats a name that is also the ENS name', () => {
  const identity = makeIdentity({ name: 'agent.owner1.eth', ensName: 'agent.owner1.eth', ensValidation: { ok: true } })
  const { lastFrame, unmount } = renderNarrow(<IdentitySummary identity={identity} />)
  try {
    const text = frameLines(lastFrame() ?? '').plain.join(' ')
    assert.equal(text.split('agent.owner1.eth').length - 1, 1)
  } finally {
    unmount()
  }
})

test('textarea renders a long edited line as budgeted rows that keep their color', () => {
  const value = 'a very long description line that keeps on going well past forty columns'
  const { lastFrame, unmount } = renderNarrow(
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

test('pinata storage prompt keeps its address intact on one line', () => {
  const { lastFrame, unmount } = renderNarrow(
    <PinataJwtInput inputKey="wrap-safety" footer={null} onSubmit={noop} onCancel={noop} />,
  )
  try {
    const { plain } = frameLines(lastFrame() ?? '')
    assertBudget(plain)
    assert.ok(
      plain.some(line => line.includes('app.pinata.cloud/developers/api-keys')),
      'the API keys address must sit intact on one line',
    )
  } finally {
    unmount()
  }
})
