import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Address } from 'viem'
import { EditProfileFlow } from '../../../src/identity/manager/profile/EditProfileFlow.js'
import { EnsFlow } from '../../../src/identity/manager/ens/EnsFlow.js'
import type { Step } from '../../../src/identity/manager/reducer.js'
import { renderEnsMaintenancePhase } from '../../../src/identity/manager/ens/EnsEditMaintenanceScreens.js'
import { RestoreFlow } from '../../../src/identity/manager/restore/RestoreFlow.js'
import { rebackupCompletionMessage } from '../../../src/identity/manager/continuity/completion.js'
import { TerminalSizeProvider } from '../../../src/ui/layout.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'
import type { Erc8004AgentCandidate, Erc8004RegistryConfig } from '../../../src/identity/registry/erc8004.js'
import type { AgentReconciliation } from '../../../src/identity/manager/shared/reconciliation/index.js'

const OWNER = '0x1111111111111111111111111111111111111111'
const REGISTRY = '0x6666666666666666666666666666666666666666'
const CONTENT_WIDTH = 42
const ESC = String.fromCharCode(27)
const stripAnsi = (value: string): string => value.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '')
const noop = (): void => {}

const registry = {
  chainId: 8453,
  rpcUrl: 'https://mainnet.base.org',
  identityRegistryAddress: REGISTRY,
} as Erc8004RegistryConfig

const reconciliation = {
  token: 'linked', custody: 'simple', agentUri: 'in-sync', vault: 'unset',
  workingTree: 'clean', rpc: 'reachable', driftCount: 0, lastCheckedAt: '2026-10-06T00:00:00.000Z',
} as AgentReconciliation

function makeIdentity(state: Record<string, unknown> = {}): EthagentIdentity {
  return {
    address: OWNER,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'erc8004',
    ownerAddress: OWNER,
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: REGISTRY,
    agentId: '7',
    agentUri: 'ipfs://bafkreiexample',
    state: { version: 1, name: 'Agent Seven', ownerAddress: OWNER, ...state },
  }
}

function frame(node: React.ReactElement): string[] {
  const { lastFrame, unmount } = render(<TerminalSizeProvider columns={54}>{node}</TerminalSizeProvider>)
  try {
    return stripAnsi(lastFrame() ?? '').split('\n')
  } finally {
    unmount()
  }
}

type ProfileStep = React.ComponentProps<typeof EditProfileFlow>['step']

function iconScreen(step: ProfileStep, onIconSubmit: (iconPath?: string) => void = noop): string[] {
  return frame(
    <EditProfileFlow
      step={step}
      reconciliation={reconciliation}
      onSelectField={noop}
      onSaveProfile={noop}
      onNameSubmit={noop}
      onDescriptionSubmit={noop}
      onIconSubmit={onIconSubmit}
      onIconPick={noop}
      onReviewSave={noop}
      onEnsLink={noop}
      onEnsUnlink={noop}
      onEnsRecordsUpdate={noop}
      onEnsSetup={noop}
      onManageOperatorWalletAccess={noop}
      onBack={noop}
      onBackToEditMenu={noop}
    />,
  )
}

test('icon screen has no option that duplicates Back', () => {
  const lines = iconScreen({ kind: 'edit-profile-image', identity: makeIdentity({ imageUrl: 'ipfs://bafkreiicon/agent.png' }), registry })
  const text = lines.join('\n')
  assert.doesNotMatch(text, /Keep Current Icon/)
  assert.doesNotMatch(text, /Undo Change/, 'nothing to undo without a pending change')
  assert.match(text, /Published icon: agent\.png/)
  assert.match(text, /Remove Icon/)
  assert.match(text, /Back/)
})

test('icon screen offers Undo Change only when a new icon is pending', () => {
  const lines = iconScreen({
    kind: 'edit-profile-image',
    identity: makeIdentity({ imageUrl: 'ipfs://bafkreiicon/agent.png' }),
    registry,
    imagePath: 'C:\\Users\\sam\\Pictures\\avatar.png',
  })
  const text = lines.join('\n')
  assert.match(text, /New icon: avatar\.png\. Publish to/)
  assert.match(text, /Undo Change/)
  assert.match(text, /Keep the published icon/)
})

test('icon screen drops Remove Icon once removal is already pending', () => {
  const lines = iconScreen({ kind: 'edit-profile-image', identity: makeIdentity({ imageUrl: 'ipfs://bafkreiicon/agent.png' }), registry, imagePath: 'delete' })
  const text = lines.join('\n')
  assert.match(text, /Publishing removes the current icon/)
  assert.doesNotMatch(text, /Remove Icon/)
  assert.match(text, /Undo Change/)
})

test('Undo Change clears the pending icon and returns to the edit menu with other drafts', async () => {
  const steps: Step[] = []
  const { stdin, unmount } = render(
    <TerminalSizeProvider columns={54}>
      <EnsFlow
        step={{
          kind: 'edit-profile-image',
          identity: makeIdentity({ imageUrl: 'ipfs://bafkreiicon/agent.png' }),
          registry,
          name: 'Draft Name',
          imagePath: '/home/sam/avatar.png',
          returnTo: { kind: 'continuity-public' },
        }}
        walletSession={null}
        reconciliation={reconciliation}
        onSetStep={step => steps.push(step)}
        onBack={noop}
        onWalletReady={noop}
        onTriggerRebackup={noop}
        onTriggerPublicProfileSave={noop}
        onWithdrawFromVault={noop}
      />
    </TerminalSizeProvider>,
  )
  try {
    const tick = () => new Promise(resolve => setTimeout(resolve, 20))
    await tick()
    for (let i = 0; i < 3; i += 1) {
      stdin.write('j')
      await tick()
    }
    stdin.write('\r')
    await tick()
    const menu = steps.at(-1)
    assert.ok(menu && menu.kind === 'edit-profile-menu', 'undo returns to the edit menu')
    if (menu?.kind !== 'edit-profile-menu') return
    assert.equal(menu.imagePath, undefined, 'the pending icon is dropped')
    assert.equal(menu.name, 'Draft Name', 'other drafts survive')
  } finally {
    unmount()
  }
})

function ensHome(ensName: string, runDeleteSubdomainPreflight: (name: string) => void = noop): string[] {
  const identity = makeIdentity({ ensName, ensValidation: { ok: true } })
  const screen = renderEnsMaintenancePhase({
    phase: { kind: 'mode-select' },
    identity,
    currentEnsName: ensName,
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
    runDeleteSubdomainPreflight,
    onBack: noop,
    onEnsUnlink: noop,
    onEnsRecordsUpdate: noop,
  })
  return frame(<>{screen}</>)
}

test('ens home offers Delete Subdomain for a linked subdomain', () => {
  const text = ensHome('agent.owner1.eth').join('\n')
  assert.match(text, /Unlink Name/)
  assert.match(text, /Delete Subdomain/)
})

test('ens home never offers Delete Subdomain for a top-level name', () => {
  const text = ensHome('owner1.eth').join('\n')
  assert.match(text, /Unlink Name/)
  assert.doesNotMatch(text, /Delete Subdomain/)
})

test('ens home Delete Subdomain runs the delete preflight for the current name', async () => {
  const seen: string[] = []
  const identity = makeIdentity({ ensName: 'agent.owner1.eth', ensValidation: { ok: true } })
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
    runDeleteSubdomainPreflight: name => seen.push(name),
    onBack: noop,
    onEnsUnlink: noop,
    onEnsRecordsUpdate: noop,
  })
  const { stdin, unmount } = render(<TerminalSizeProvider columns={54}>{screen}</TerminalSizeProvider>)
  try {
    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('j')
    await new Promise(resolve => setTimeout(resolve, 20))
    stdin.write('\r')
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(seen, ['agent.owner1.eth'])
  } finally {
    unmount()
  }
})

function candidate(agentId: bigint, name: string, restorable = true): Erc8004AgentCandidate {
  return {
    ownerAddress: OWNER as Address,
    chainId: 8453,
    rpcUrl: registry.rpcUrl,
    identityRegistryAddress: REGISTRY as Address,
    agentId,
    agentUri: 'ipfs://example',
    name,
    ...(restorable ? { backup: { cid: `bafy${agentId}` } } : {}),
    registration: null,
  }
}

test('restore list keeps a long agent name on one row with its token id inline', () => {
  const lines = frame(
    <RestoreFlow
      step={{
        kind: 'restore-select-token',
        ownerHandle: OWNER,
        registry,
        candidates: [
          candidate(7n, 'Agent Seven'),
          candidate(8n, 'Release Notes Assistant for the Northwind Platform Team'),
          candidate(9n, 'Scratch Agent', false),
        ],
      }}
      walletSession={null}
      restoreProgress={null}
      onRestoreRegistrySubmit={noop}
      onRetryDiscovery={noop}
      onTokenSelect={noop}
      onEnsSubmit={noop}
      onTokenIdSubmit={noop}
      onPickRecoveryMethod={noop}
      onBack={noop}
    />,
  )
  for (const line of lines) assert.ok(line.trim().length <= CONTENT_WIDTH, `row exceeds the panel: ${JSON.stringify(line.trim())}`)
  const longRow = lines.find(line => line.includes('Release Notes'))
  assert.ok(longRow && longRow.includes('…') && longRow.includes('#8'), 'the long name truncates and keeps its token id inline')
  assert.ok(!lines.some(line => line.includes('Platform Team')), 'the name must not wrap onto a second row')
  const scratchRow = lines.find(line => line.includes('Scratch Agent'))
  assert.ok(scratchRow && scratchRow.includes('#9 · no snapshot'), 'every hint shares one column')
})

test('completion messages read as sentences', () => {
  const identity = makeIdentity({ ensName: 'agent.owner1.eth' })
  assert.equal(rebackupCompletionMessage(undefined, identity), 'Snapshot saved.')
  assert.equal(rebackupCompletionMessage({ name: 'New' }, identity), 'Profile published.')
  assert.equal(rebackupCompletionMessage({ ensName: '' }, identity), 'ENS name unlinked.')
  assert.equal(rebackupCompletionMessage({ ensName: 'next.owner1.eth' }, identity, true), 'next.owner1.eth is linked to your agent.')
  assert.equal(rebackupCompletionMessage({ approvedOperatorWallets: [] }, identity), 'Operator wallets updated.')
})
