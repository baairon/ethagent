import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  __testWalletPage,
  requestBrowserWalletAccount,
  requestBrowserWalletSignature,
} from '../src/identity/browserWallet.js'

test('browser wallet bridge exposes a clean localhost approval URL', async () => {
  let resolveReady: (ready: { url: string }) => void
  const readyPromise = new Promise<{ url: string }>(resolve => {
    resolveReady = resolve
  })
  const walletPromise = requestBrowserWalletSignature({
    chainId: 1,
    message: 'ethagent test',
    timeoutMs: 5_000,
    onReady: ready => resolveReady(ready),
  }).then(
    () => null,
    err => err as Error,
  )

  const ready = await readyPromise
  assert.match(ready.url, /^http:\/\/localhost:\d+\/$/)
  assert.equal(ready.url.includes('/wallet/'), false)

  const page = await fetch(ready.url).then(response => response.text())
  const token = page.match(/"sessionToken":"([^"]+)"/)?.[1]
  assert.ok(token, 'page should embed a hidden session token for POST validation')

  await fetch(new URL('/cancel', ready.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken: token }),
  })

  const result = await walletPromise
  assert.match(result?.message ?? '', /cancelled/)
})

test('browser wallet page explains the wallet approval', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x1',
    message: 'hello',
  })

  assert.match(page, /<title>ethagent wallet signature<\/title>/)
  assert.match(page, /window\.__WALLET_CONFIG__/)
  assert.match(page, /"sessionToken":"hidden-token"/)
  assert.match(page, /"chainIdHex":"0x1"/)
  assert.match(page, /<div class="head">[\s\S]*signature request[\s\S]*network/)
  assert.match(page, /Sign a message to prove ownership/)
  assert.match(page, /wrong network/)
  assert.match(page, /cancelled/)
  assert.doesNotMatch(page, /\d{4}-\d{4}/)
  assert.doesNotMatch(page, /localhost only/)
  assert.doesNotMatch(page, /import private key/i)
  assert.match(page, /personal_sign/)
  assert.match(page, /post\('\/complete'/)
  assert.match(page, /post\('\/cancel'/)
  assert.match(page, /setTimeout\(runWalletFlow, 150\)/)
  assert.match(page, /glyphs/)
  assert.match(page, /CLOSE_DELAY_MS = 1800/)
  assert.match(page, /CANCEL_CLOSE_DELAY_MS = 3200/)
  assert.match(page, /WALLET_PROVIDER_WAIT_MS = 3000/)
  assert.match(page, /eip6963:requestProvider/)
  assert.doesNotMatch(page, /ethagent needs a wallet extension installed/)
  assert.match(page, /focus-visible/)
})

test('browser wallet page differentiates transaction requests', () => {
  const page = __testWalletPage('ethagent wallet transaction', 'hidden-token', {
    kind: 'transaction',
    chainIdHex: '0x2105',
    expectedAccount: '0x000000000000000000000000000000000000dEaD',
    tx: {
      to: '0x0000000000000000000000000000000000000001',
      data: '0x1234',
    },
  })

  assert.match(page, /transaction request/)
  assert.match(page, /Submit transaction to mint your ERC-8004 agent/)
  assert.match(page, /eth_sendTransaction/)
  assert.match(page, /Base/)
  assert.match(page, /registry/)
  assert.match(page, /"expectedAccount":"0x000000000000000000000000000000000000dEaD"/)
})

test('browser wallet page supports the single signature and transaction flow', () => {
  const page = __testWalletPage('ethagent wallet approval', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x14a34',
    message: 'identity update',
  })

  assert.match(page, /identity approval/)
  assert.match(page, /Sign and submit in one wallet flow/)
  assert.match(page, /post\('\/prepare-transaction'/)
  assert.match(page, /approve-sign/)
  assert.match(page, /approve-transaction/)
  assert.match(page, /saving encrypted IPFS backup/)
})

test('browser wallet page supports account-only connection requests', () => {
  const page = __testWalletPage('ethagent wallet connection', 'hidden-token', {
    kind: 'account',
  })

  assert.match(page, /wallet request/)
  assert.match(page, /Connect wallet to find your agent/)
  assert.match(page, /selected in wallet/)
  assert.match(page, /"kind":"account"/)
})

test('browser wallet account requests return the connected address without a signature', async () => {
  let resolveReady: (ready: { url: string }) => void
  const readyPromise = new Promise<{ url: string }>(resolve => {
    resolveReady = resolve
  })
  const walletPromise = requestBrowserWalletAccount({
    timeoutMs: 5_000,
    onReady: ready => resolveReady(ready),
  })

  const ready = await readyPromise
  const page = await fetch(ready.url).then(response => response.text())
  const token = page.match(/"sessionToken":"([^"]+)"/)?.[1]
  assert.ok(token, 'page should embed a hidden session token for POST validation')

  await fetch(new URL('/complete', ready.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionToken: token,
      account: '0x000000000000000000000000000000000000dEaD',
    }),
  })

  const result = await walletPromise
  assert.equal(result.account, '0x000000000000000000000000000000000000dEaD')
})

test('wallet preview assets stay outside shipped wallet assets', () => {
  const index = readFileSync('test/manual/wallet-preview/index.html', 'utf8')
  const tweaks = readFileSync('test/manual/wallet-preview/tweaks-panel.jsx', 'utf8')
  const wallet = readFileSync('src/identity/wallet-page/wallet.html', 'utf8')

  assert.match(index, /src="wallet\.html"/)
  assert.match(index, /src="tweaks-panel\.jsx"/)
  assert.match(tweaks, /function TweaksPanel/)
  assert.match(tweaks, /function useTweaks/)
  assert.doesNotMatch(wallet, /tweaks-panel/)
})
