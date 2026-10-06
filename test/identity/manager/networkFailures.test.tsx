import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { getAddress } from 'viem'
import { ErrorScreen } from '../../../src/identity/manager/shared/components/ErrorScreen.js'
import { identityManagerErrorView, networkFailureSentence } from '../../../src/identity/manager/shared/model/errors.js'
import { RestoreFlow } from '../../../src/identity/manager/restore/RestoreFlow.js'
import { restoreTokenSelectionStep } from '../../../src/identity/manager/restore/discover.js'
import { runRestoreFetch } from '../../../src/identity/manager/restore/fetch.js'
import { downloadProgress } from '../../../src/identity/manager/restore/progress.js'
import { awaitConfirmedReceipt } from '../../../src/identity/manager/shared/effects/receipts.js'
import { scopeCallbacks, type EffectCallbacks, type RestoreProgress } from '../../../src/identity/manager/shared/effects/types.js'
import type { Step } from '../../../src/identity/manager/reducer.js'
import {
  AgentTokenIdRequiredError,
  DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
  discoverOwnedAgentBackupByTokenId,
  discoverOwnedAgentBackups,
  MetadataFetchError,
} from '../../../src/identity/registry/erc8004.js'
import { IpfsReadError, resetIpfsDiscoveryForTest } from '../../../src/identity/storage/ipfsRead.js'
import { PINATA_UPLOAD_API_URL } from '../../../src/identity/storage/ipfs.js'
import { isAbortError, NetError, resetHostStatsForTest } from '../../../src/net/adaptive.js'
import { RpcUnansweredError } from '../../../src/net/rpc.js'
import { TerminalSizeProvider } from '../../../src/ui/layout.js'
import { rawCid } from '../../support/home.js'
import { candidate, registry } from './effects/effects.fixtures.js'

const ESC = String.fromCharCode(27)
const stripAnsi = (value: string): string => value.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '')
const noop = (): void => {}
const VPN_HINT = 'If a VPN is on, switch servers or pause it, then try again.'

function screen(node: React.ReactElement): { text: () => string; stdin: { write: (data: string) => void }; unmount: () => void } {
  const { lastFrame, stdin, unmount } = render(<TerminalSizeProvider columns={72}>{node}</TerminalSizeProvider>)
  return { text: () => stripAnsi(lastFrame() ?? ''), stdin, unmount }
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for ${what}`)
}

const downloadFailure = (): IpfsReadError => new IpfsReadError('bafkreihaxvcxh3stwosqb7zeyuzfxv7vnu7xzlydcf7kh27qxdgd7li37i', [
  { host: 'ipfs.filebase.io', outcome: 'connection reset' },
  { host: 'gateway.pinata.cloud', outcome: 'not found' },
])

test('a failed IPFS download is shown by source, with what to try, never as a raw network error', () => {
  const expected = {
    title: 'IPFS Download Failed',
    detail: 'No source returned the file.\nipfs.filebase.io: connection reset\ngateway.pinata.cloud: not found',
    hint: VPN_HINT,
  }
  assert.deepEqual(identityManagerErrorView(downloadFailure()), expected)
  assert.deepEqual(
    identityManagerErrorView(new MetadataFetchError(45744n, 'ipfs://bafkreihax', downloadFailure())),
    expected,
    'the same view when the download failed underneath a token lookup',
  )
})

test('a broken connection is named by host instead of landing on Identity Error', () => {
  assert.deepEqual(identityManagerErrorView(new NetError('uploads.pinata.cloud', 'reset')), {
    title: 'Connection Failed',
    detail: 'uploads.pinata.cloud: connection reset.',
    hint: VPN_HINT,
  })
  const bare = identityManagerErrorView(new TypeError('fetch failed'))
  assert.equal(bare.title, 'Connection Failed')
  assert.doesNotMatch(bare.detail ?? '', /fetch failed/)
})

test('a network failure reads as one paragraph where a screen explains it inline', () => {
  assert.equal(
    networkFailureSentence(new MetadataFetchError(45744n, 'ipfs://bafkreihax', downloadFailure())),
    `No IPFS source returned the file (ipfs.filebase.io connection reset, gateway.pinata.cloud not found). ${VPN_HINT}`,
  )
  const scanFailed = new AgentTokenIdRequiredError({
    ownerAddress: getAddress('0x000000000000000000000000000000000000dEaD'),
    registry,
    balance: 0n,
    cause: new Error('viem wrapper', { cause: new RpcUnansweredError([{ host: 'mainnet.base.org', outcome: 'connection reset' }]) }),
  })
  assert.equal(
    networkFailureSentence(scanFailed),
    `No RPC endpoint answered (mainnet.base.org connection reset). ${VPN_HINT}`,
    'a failed wallet scan keeps the reason it failed',
  )
  assert.equal(networkFailureSentence(new NetError('api.pinata.cloud', 'dns')), `api.pinata.cloud: DNS lookup failed. ${VPN_HINT}`)
  assert.equal(networkFailureSentence(new Error('Wallet is not the token owner')), null, 'anything else keeps its own wording')
})

test('the error screen offers Try Again and Back, and nothing that quits the app', async () => {
  const retry: Step = { kind: 'restore-fetching', cid: 'bafy-state', apiUrl: 'https://example.com', candidate: candidate(1n, 'bafy-state'), purpose: 'restore' }
  const back: Step = { kind: 'menu' }
  const chosen: Step[] = []
  const view = screen(
    <ErrorScreen
      error={identityManagerErrorView(downloadFailure())}
      back={back}
      retry={retry}
      footer={null}
      onBack={step => chosen.push(step)}
      onRetry={step => chosen.push(step)}
    />,
  )
  try {
    const text = view.text()
    assert.match(text, /IPFS Download Failed/)
    assert.match(text, /ipfs\.filebase\.io: connection reset/)
    assert.match(text, /❯ Try Again/, 'Try Again is first and preselected')
    assert.match(text, /Back/)
    assert.doesNotMatch(text, /Close|Quit|Exit/)
    // One timer turn after a frame lets React attach that render's key handler.
    await new Promise(resolve => setTimeout(resolve, 20))
    view.stdin.write('\r')
    await until(() => chosen.length === 1, 'the retry')
    assert.equal(chosen[0], retry)
    await new Promise(resolve => setTimeout(resolve, 20))
    view.stdin.write(ESC)
    await until(() => chosen.length === 2, 'esc going back')
    assert.equal(chosen[1], back, 'esc goes back, it never leaves the app')
  } finally {
    view.unmount()
  }
})

test('an error with nothing to retry offers only Back', () => {
  const view = screen(
    <ErrorScreen
      error={{ title: 'Owner Wallet Required', detail: 'Connect the owner wallet.' }}
      back={{ kind: 'menu' }}
      footer={null}
      onBack={noop}
      onRetry={noop}
    />,
  )
  try {
    const text = view.text()
    assert.match(text, /❯ Back/)
    assert.doesNotMatch(text, /Try Again|Close/)
  } finally {
    view.unmount()
  }
})

test('download progress reads as megabytes moved, with the total only when it is trustworthy', () => {
  assert.deepEqual(downloadProgress({ bytes: 1_258_291, total: 4_793_202, host: 'gateway-v3.pinata.cloud' }), {
    phase: 'downloading',
    label: 'Downloading… 1.2 of 4.6 MB',
    detail: 'Downloading the encrypted snapshot from gateway-v3.pinata.cloud.',
  })
  assert.equal(downloadProgress({ bytes: 52_428_800, total: 104_857_600, host: 'h' }).label, 'Downloading… 50 of 100 MB')
  assert.equal(downloadProgress({ bytes: 1_258_291, host: 'h' }).label, 'Downloading… 1.2 MB')
  assert.equal(
    downloadProgress({ bytes: 3_000_000, total: 1_000_000, host: 'h' }).label,
    'Downloading… 2.9 MB',
    'a compressed length smaller than what arrived is not shown as a total',
  )
})

function restoreScreen(step: React.ComponentProps<typeof RestoreFlow>['step'], restoreProgress: RestoreProgress | null = null): string {
  const view = screen(
    <RestoreFlow
      step={step}
      walletSession={null}
      restoreProgress={restoreProgress}
      onRestoreRegistrySubmit={noop}
      onRetryDiscovery={noop}
      onTokenSelect={noop}
      onEnsSubmit={noop}
      onTokenIdSubmit={noop}
      onPickRecoveryMethod={noop}
      onBack={noop}
    />,
  )
  try {
    return view.text()
  } finally {
    view.unmount()
  }
}

test('the download screen shows how much has arrived and from where, and can be cancelled', () => {
  const step: Step = { kind: 'restore-fetching', cid: 'bafy-state', apiUrl: 'https://example.com', candidate: candidate(1n, 'bafy-state'), purpose: 'restore' }
  const searching = restoreScreen(step as never)
  assert.match(searching, /Finding the encrypted snapshot on IPFS\./)
  assert.match(searching, /esc/i, 'the download can be cancelled')

  const moving = restoreScreen(step as never, downloadProgress({ bytes: 1_258_291, total: 4_793_202, host: 'gateway-v3.pinata.cloud' }))
  assert.match(moving, /Downloading… 1\.2 of 4\.6 MB/)
  assert.match(moving.replace(/\s+/g, ' '), /from gateway-v3\.pinata\.cloud/)
})

test('an agent whose profile did not download stays in the list, marked and not selectable', () => {
  const unreadable = { ...candidate(9n), name: undefined, metadataError: 'No IPFS source returned bafkreihax…li37i.' }
  const step = restoreTokenSelectionStep({
    ownerHandle: '0x000000000000000000000000000000000000dEaD',
    registry,
    candidates: [candidate(7n, 'bafy-seven'), unreadable, candidate(8n)],
    purpose: 'restore',
  })
  assert.deepEqual(step.candidates.map(item => item.agentId), [7n, 9n], 'the unreadable agent is kept, the one with no snapshot is not')
  const text = restoreScreen(step as never)
  const row = text.split('\n').find(line => line.includes('#9')) ?? text.split('\n').find(line => line.includes('profile unreadable'))
  assert.ok(row && row.includes('profile unreadable'), 'the row says why it cannot be opened')
})

test('an incomplete search says why', () => {
  const text = restoreScreen({
    kind: 'restore-not-found',
    ownerHandle: '0x000000000000000000000000000000000000dEaD',
    registry,
    reason: 'search-incomplete',
    detail: 'No RPC endpoint answered. If a VPN is on, switch servers or pause it, then try again.',
  } as never)
  assert.match(text, /Agent Search Incomplete/)
  assert.match(text, /No RPC endpoint answered\./)
  assert.match(text, /Search Again/)
})

const OWNER = getAddress('0x000000000000000000000000000000000000dEaD')
const OTHER = getAddress('0x000000000000000000000000000000000000bEEF')
const UNREADABLE_CID = rawCid(new TextEncoder().encode('{"name":"never downloads"}'))

function agentDataUri(cid: string, name: string): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify({
    name,
    'x-ethagent': { backup: { cid, envelopeVersion: 'ethagent-state-backup-v1', createdAt: new Date(0).toISOString() } },
  }))}`
}

// A wallet holding token 1 (readable), token 2 (profile on IPFS that no source returns),
// and seeing token 3, which belongs to someone else and is unreadable too.
function walletWithUnreadableToken(): unknown {
  return {
    readContract: async (call: { functionName: string; args: unknown[] }) => {
      if (call.functionName === 'balanceOf') return 3n
      if (call.functionName === 'tokenOfOwnerByIndex') return [1n, 2n, 3n][Number(call.args[1])]
      if (call.functionName === 'ownerOf') return call.args[0] === 3n ? OTHER : OWNER
      if (call.functionName === 'tokenURI') return call.args[0] === 1n ? agentDataUri('bafy-state-one', 'readable agent') : `ipfs://${UNREADABLE_CID}`
      if (call.functionName === 'agentOwner') return '0x0000000000000000000000000000000000000000'
      throw new Error(`unexpected read: ${call.functionName}`)
    },
  }
}

const nothingOnIpfs = async (): Promise<Response> => new Response('not found', { status: 404 })

test('one unreadable profile no longer fails the whole wallet search', async () => {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
  const found = await discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: OWNER,
    publicClient: walletWithUnreadableToken() as never,
    fetchImpl: nothingOnIpfs,
  })
  assert.deepEqual(found.map(item => item.agentId), [2n, 1n], 'the token someone else holds is left out')
  const [unreadable, readable] = found
  assert.equal(readable?.backup?.cid, 'bafy-state-one')
  assert.equal(unreadable?.backup, undefined)
  assert.equal(unreadable?.registration, null)
  assert.match(unreadable?.metadataError ?? '', /^No IPFS source returned /)
  assert.equal(unreadable?.ownerAddress, OWNER)
})

test('looking up one token by id still fails loudly, carrying the per-source reasons', async () => {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
  const err = await discoverOwnedAgentBackupByTokenId({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: OWNER,
    tokenId: 2n,
    publicClient: walletWithUnreadableToken() as never,
    fetchImpl: nothingOnIpfs,
  }).then(() => null, (reason: unknown) => reason)
  assert.ok(err instanceof MetadataFetchError)
  assert.match(err.message, /^The profile for token #2 did not download\. No IPFS source returned /)
  assert.doesNotMatch(err.message, new RegExp(UNREADABLE_CID), 'the full CID stays out of the message')
  assert.ok(err.cause instanceof IpfsReadError)
  assert.deepEqual(err.cause.outcomes.map(item => item.outcome), ['not found', 'not found', 'not found'])
  assert.equal(identityManagerErrorView(err).title, 'IPFS Download Failed')
})

function fetchStep(cid: string): Extract<Step, { kind: 'restore-fetching' }> {
  return { kind: 'restore-fetching', cid, apiUrl: PINATA_UPLOAD_API_URL, candidate: candidate(1n, cid), purpose: 'restore' }
}

test('a download that finishes after the user cancelled does not open the next screen', async t => {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
  const bytes = new TextEncoder().encode('{"late":true}')
  const cid = rawCid(bytes)
  t.mock.method(globalThis, 'fetch', async (input: string | URL) =>
    String(input).includes(`/ipfs/${cid}`) ? new Response(Buffer.from(bytes)) : new Response('not found', { status: 404 }))
  const steps: Step[] = []
  const progress: Array<RestoreProgress | null> = []
  const scope = scopeCallbacks({
    onStep: step => steps.push(step),
    onWalletReady: noop,
    onIdentityComplete: async () => {},
    onRestoreProgress: event => {
      progress.push(event)
      scope.cancel()
    },
  } satisfies EffectCallbacks)
  await runRestoreFetch(fetchStep(cid), scope.callbacks)
  assert.equal(progress[0]?.phase, 'downloading', 'the download itself completed and reported progress')
  assert.deepEqual(steps, [], 'but the cancelled flow never advances to the signature screen')
})

test('cancelling a download in flight stops it as cancelled', async t => {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
  const cid = rawCid(new TextEncoder().encode('{"never":"arrives"}'))
  t.mock.method(globalThis, 'fetch', (_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  }))
  const steps: Step[] = []
  const scope = scopeCallbacks({ onStep: step => steps.push(step), onWalletReady: noop, onIdentityComplete: async () => {} })
  const fetching = runRestoreFetch(fetchStep(cid), scope.callbacks).then(() => null, (reason: unknown) => reason)
  await new Promise(resolve => setImmediate(resolve))
  scope.cancel()
  assert.ok(isAbortError(await fetching))
  assert.deepEqual(steps, [])
})

test('receipt waits carry no hidden deadline: a slow transaction is not reported as failed', async () => {
  const seen: Array<Record<string, unknown>> = []
  const client = {
    waitForTransactionReceipt: async (args: Record<string, unknown>) => {
      seen.push(args)
      return { status: 'success' }
    },
  }
  await awaitConfirmedReceipt(client as never, '0xabc', 'Agent registration')
  assert.deepEqual(seen, [{ hash: '0xabc', timeout: 0 }])
})
