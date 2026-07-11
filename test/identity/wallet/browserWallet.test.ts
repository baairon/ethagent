import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import {
  __testWalletPage,
  openBrowserWalletSession,
  requestBrowserWalletAccount,
  requestBrowserWalletSignature,
} from '../../../src/identity/wallet/browserWallet.js'
import { loadWalletPageRawSource, stripWalletModuleSyntax } from '../../../src/identity/wallet/browserWallet/walletPageSource.js'

function readWalletPageSource(): string {
  const source = loadWalletPageRawSource()
  const bundled = transformSync(stripWalletModuleSyntax(source), {
    loader: 'ts',
    target: 'es2020',
  }).code
  return source + '\n' + bundled
}

test('browser wallet bridge exposes a clean localhost wallet URL', async () => {
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

function getWithHost(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = http.request(
      { hostname: target.hostname, port: target.port, path: '/', method: 'GET', headers: { host } },
      res => {
        let body = ''
        res.on('data', chunk => { body += String(chunk) })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('wallet page GET refuses non-loopback Host headers so the session token never leaks', async () => {
  let resolveReady: (ready: { url: string }) => void
  const readyPromise = new Promise<{ url: string }>(resolve => {
    resolveReady = resolve
  })
  const walletPromise = requestBrowserWalletSignature({
    chainId: 1,
    message: 'ethagent host test',
    timeoutMs: 5_000,
    onReady: ready => resolveReady(ready),
  }).then(
    () => null,
    err => err as Error,
  )

  const ready = await readyPromise
  const rebound = await getWithHost(ready.url, 'evil.example')
  assert.equal(rebound.status, 403)
  assert.doesNotMatch(rebound.body, /sessionToken/)

  const page = await fetch(ready.url).then(response => response.text())
  const token = page.match(/"sessionToken":"([^"]+)"/)?.[1]
  assert.ok(token, 'loopback GET must still serve the page')
  await fetch(new URL('/cancel', ready.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken: token }),
  })
  const result = await walletPromise
  assert.match(result?.message ?? '', /cancelled/)
})

test('wallet session page GET refuses non-loopback Host headers', async () => {
  const session = await openBrowserWalletSession({})
  try {
    const rebound = await getWithHost(session.url, 'evil.example')
    assert.equal(rebound.status, 403)
    const ok = await fetch(session.url)
    assert.equal(ok.status, 200)
  } finally {
    await session.close()
  }
})

test('browser wallet page explains the wallet signature request', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x1',
    message: 'hello',
  })

  assert.match(page, /<title>ethagent wallet signature<\/title>/)
  assert.match(page, /window\.__WALLET_CONFIG__/)
  assert.match(page, /"sessionToken":"hidden-token"/)
  assert.match(page, /"chainIdHex":"0x1"/)
  assert.match(page, /class="card-header"[\s\S]*flow-title/)
  assert.match(page, /Signature Request/)
  assert.doesNotMatch(page, /id="network-row"/)
  assert.match(page, /Sign Message/)
  assert.match(page, /wrong network/i)
  assert.match(page, /cancelled/)
  assert.doesNotMatch(page, /(?<!U\+)\d{4}-\d{4}/)
  assert.doesNotMatch(page, /localhost only/)
  assert.doesNotMatch(page, /import private key/i)
  assert.match(page, /personal_sign/)
  assert.match(page, /post\("\/complete"/)
  assert.match(page, /post\("\/cancel"/)
  assert.match(page, /function bootWallet[\s\S]*?runWalletFlow\(\)/)
  assert.match(page, /injectStylesAndMarkup\(\)[\s\S]*bootWallet\(\)/)
  assert.match(page, /function bootWallet[\s\S]*?initializeViewElements\(\)[\s\S]*?attachWalletHandlers\(\)/)
  assert.doesNotMatch(page, /^\s*import\s/m)
  assert.doesNotMatch(page, /^\s*export\s/m)
  assert.doesNotMatch(page, /awaiting-connect/)
  assert.doesNotMatch(page, /Tap Connect/)
  assert.doesNotMatch(page, /chrome-connect/)
  assert.match(page, /glyphs/)
  assert.match(page, /CLOSE_DELAY_MS = 1e4/)
  assert.match(page, /TX_CLOSE_DELAY_MS = 1e4/)
  assert.match(page, /CANCEL_CLOSE_DELAY_MS = 1e4/)
  assert.match(page, /return to your terminal\. closing in " \+ seconds \+ "s\./i)
  assert.match(page, /WALLET_PROVIDER_WAIT_MS = 3e3/)
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

  assert.match(page, /Onchain Transaction/)
  assert.match(page, /Submit Transaction/)
  assert.match(page, /eth_sendTransaction/)
  assert.match(page, /Base/)
  assert.match(page, /registry/)
  assert.doesNotMatch(page, /tx-summary/)
  assert.doesNotMatch(page, /transactionActionLabel/)
  assert.doesNotMatch(page, /\['wallet'/)
  assert.doesNotMatch(page, /\['registry'/)
  assert.doesNotMatch(page, /\['data'/)
  assert.doesNotMatch(page, /\['tx hash'/)
  assert.match(page, /"expectedAccount":"0x000000000000000000000000000000000000dEaD"/)
})

test('browser wallet page supports the single signature and transaction flow', () => {
  const page = __testWalletPage('ethagent wallet request', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x14a34',
    message: 'identity update',
  })

  assert.match(page, /Snapshot Signature/)
  assert.match(page, /Sign Snapshot/)
  assert.match(page, /post\("\/prepare-transaction"/)
  assert.match(page, /approve-sign/)
  assert.match(page, /approve-transaction/)
  assert.match(page, /Saving Snapshot/)
  assert.doesNotMatch(page, /this tab will close after you can read the hash/)
})

test('wallet timeline renders a discrete segmented stepper, not a fractional fill bar', () => {
  const page = readWalletPageSource()

  assert.match(page, /renderTimelineSegments/)
  assert.match(page, /timeline-seg/)
  assert.match(page, /is-active/)
  assert.match(page, /is-done/)
  assert.doesNotMatch(page, /timeline-fill/, 'continuous fill bar must be gone')
  assert.doesNotMatch(page, /\(activeIndex \+ 0\.5\)/, 'midpoint fraction formula must be gone')
})

test('browser wallet page updates generated signature message details', () => {
  const page = __testWalletPage('ethagent wallet request', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x2105',
  })

  assert.doesNotMatch(page, /prepared at signing time/)
  assert.match(page, /function showPreparedMessage/)
  assert.match(page, /showPreparedMessage\(prepared\.message\)/)
})

test('browser wallet page supports account-only connection requests', () => {
  const page = __testWalletPage('ethagent wallet connection', 'hidden-token', {
    kind: 'account',
  })

  assert.match(page, /Connection Request/)
  assert.match(page, /"kind":"account"/)
  assert.match(page, /requirePurposeSubCopy\("account"\)/)
})

test('browser wallet page labels operator-wallet account connection requests', () => {
  const page = __testWalletPage('ethagent wallet connection', 'hidden-token', {
    kind: 'account',
    purpose: 'connect-operator-wallet',
  })

  assert.match(page, /"purpose":"connect-operator-wallet"/)
  assert.match(page, /Connect Wallet/)
  assert.match(page, /Reads the operator wallet address/)
  assert.match(page, /No signature or transaction/)
})

test('browser wallet page explains operator-wallet restore proof without token approval claims', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x2105',
    purpose: 'operator-proof',
    message: 'operator proof',
  })

  assert.match(page, /Operator Wallet Required/)
  assert.match(page, /Sign With Operator Wallet/)
  assert.match(page, /Creates restore access/)
  assert.match(page, /No token approval/)
})

test('browser wallet page clearly requests owner wallet for restore signatures', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x2105',
    purpose: 'restore-owner-wallet',
    expectedAccount: '0x000000000000000000000000000000000000c01d',
    message: 'restore challenge',
  })

  assert.match(page, /Owner Wallet Required/)
  assert.match(page, /Sign With Owner Wallet/)
  assert.match(page, /Decrypts this snapshot/)
  assert.match(page, /0x0+c01d/)
})

test('browser wallet page clearly requests operator wallet for restore signatures when a slot exists', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x2105',
    purpose: 'restore-operator-wallet',
    expectedAccount: '0x0000000000000000000000000000000000000A11',
    message: 'restore challenge',
  })

  assert.match(page, /Operator Wallet Required/)
  assert.match(page, /Sign With Operator Wallet/)
  assert.match(page, /Decrypts this snapshot/)
})

test('browser wallet page explains ENS record clearing on Ethereum mainnet', () => {
  const page = __testWalletPage('ethagent wallet transaction', 'hidden-token', {
    kind: 'transaction',
    chainIdHex: '0x1',
    purpose: 'clear-ens-records',
    expectedAccount: '0x000000000000000000000000000000000000c01d',
    tx: {
      to: '0x0000000000000000000000000000000000000001',
      data: '0x1234',
    },
  })

  assert.match(page, /Submit With ENS Controller Wallet/)
  assert.match(page, /Submit With ENS Controller Wallet/)
  assert.match(page, /Ethereum Mainnet/)
  assert.match(page, /eth_sendTransaction/)
})

test('browser wallet page explains owner-signed operator wallet list', () => {
  const page = __testWalletPage('ethagent wallet request', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x2105',
    purpose: 'update-operators',
    message: 'operator update',
  })

  assert.match(page, /Owner Wallet Required/)
  assert.match(page, /Sign With Owner Wallet/)
  assert.match(page, /operator wallet access/)
  assert.match(page, /No token approval/)
})

test('browser wallet page gives actionable revert guidance', () => {
  const page = __testWalletPage('ethagent wallet transaction', 'hidden-token', {
    kind: 'transaction',
    chainIdHex: '0x1',
    purpose: 'set-agent-ens-records',
    expectedAccount: '0x000000000000000000000000000000000000c01d',
    tx: {
      to: '0x0000000000000000000000000000000000000001',
      data: '0x1234',
    },
  })

  assert.match(page, /Transaction Reverted/)
  assert.match(page, /Use the expected wallet/)
  assert.match(page, /check ENS ownership/)
  assert.match(page, /Wallet Error/)
})

test('browser wallet timeout error is capitalized', async () => {
  await assert.rejects(
    requestBrowserWalletAccount({ timeoutMs: 10 }),
    /Wallet Request Timed Out/,
  )
})

test('every WalletPurpose has a PURPOSE_COPY entry in the wallet page', () => {
  const walletPage = readWalletPageSource()
  const browserWallet = readFileSync('src/identity/wallet/browserWallet/types.ts', 'utf8')
  const unionMatch = browserWallet.match(/export type WalletPurpose =\s*([\s\S]*?)\n\n/)
  assert.ok(unionMatch, 'expected to find WalletPurpose union in browserWallet/types.ts')
  const purposes = Array.from(unionMatch![1]!.matchAll(/'([\w-]+)'/g)).map(m => m[1])
  assert.ok(purposes.length > 0, 'expected at least one WalletPurpose literal')
  for (const purpose of purposes) {
    assert.match(walletPage, new RegExp('"' + purpose + '"\\s*:'), `wallet page PURPOSE_COPY missing entry for purpose "${purpose}"`)
  }
})

test('every PURPOSE_COPY entry exposes prepare + at least one approval sub-key', () => {
  const walletPage = readWalletPageSource()
  const purposeCopyMatch = walletPage.match(/const PURPOSE_COPY = \{([\s\S]*?)\n\};/)
  assert.ok(purposeCopyMatch, 'expected to find PURPOSE_COPY block in wallet.js')
  const block = purposeCopyMatch![1]!
  const entryRegex = /^  "([\w-]+)": \{([\s\S]*?)^  \}/gm
  const entries = Array.from(block.matchAll(entryRegex))
  assert.ok(entries.length > 0, 'expected at least one PURPOSE_COPY entry')
  for (const entry of entries) {
    const purpose = entry[1]!
    const body = entry[2]!
    const hasSign = /\bsign:\s*\{[^}]*\btext:\s*"[^"]+"\s*,\s*hint:\s*"[^"]+"/.test(body)
    const hasTransaction = /\btransaction:\s*\{[^}]*\btext:\s*"[^"]+"\s*,\s*hint:\s*"[^"]+"/.test(body)
    const hasAccount = /\baccount:\s*\{[^}]*\btext:\s*"[^"]+"\s*,\s*hint:\s*"[^"]+"/.test(body)
    const hasPrepare = /\bprepare:\s*\{[^}]*\btext:\s*"[^"]+"\s*,\s*hint:\s*"[^"]+"/.test(body)
    assert.ok(hasPrepare, `purpose "${purpose}" missing prepare {text, hint}`)
    assert.ok(
      hasSign || hasTransaction || hasAccount,
      `purpose "${purpose}" must define sign, transaction, or account {text, hint}`,
    )
  }
})

test('PURPOSE_COPY copy uses owner/operator wallet terminology in user-visible strings', () => {
  const walletPage = readWalletPageSource()
  const purposeCopyMatch = walletPage.match(/const PURPOSE_COPY = \{([\s\S]*?)\n\};/)
  assert.ok(purposeCopyMatch, 'expected to find PURPOSE_COPY block in wallet.js')
  const block = purposeCopyMatch![1]!
  const labels = Array.from(block.matchAll(/"[^"]*\b(owner|operator)\s+wallet\b[^"]*"/gi)).map(m => m[0])
  assert.ok(labels.length > 0, 'wallet copy should use owner/operator wallet labels')
})

test('deploy-agent-vault is in the WalletPurpose union and has transaction copy', () => {
  const browserWallet = readFileSync('src/identity/wallet/browserWallet/types.ts', 'utf8')
  const walletPage = readWalletPageSource()
  assert.match(browserWallet, /'deploy-agent-vault'/)
  const entryMatch = walletPage.match(/"deploy-agent-vault":\s*\{([\s\S]*?)^  \}/m)
  assert.ok(entryMatch, 'expected deploy-agent-vault entry in PURPOSE_COPY')
  const body = entryMatch![1]!
  assert.match(body, /transaction:\s*\{[^}]*text:\s*"[^"]+"\s*,\s*hint:\s*"[^"]+"/)
})

test('publish-transfer-snapshot purpose defines transaction copy (regression for prepare-token-transfer crash)', () => {
  const walletPage = readWalletPageSource()
  const entryMatch = walletPage.match(/"publish-transfer-snapshot":\s*\{([\s\S]*?)^  \}/m)
  assert.ok(entryMatch, 'expected publish-transfer-snapshot entry in PURPOSE_COPY')
  const body = entryMatch![1]!
  assert.match(body, /transaction:\s*\{[^}]*text:\s*"[^"]+"\s*,\s*hint:\s*"[^"]+"/, 'publish-transfer-snapshot must define transaction text+hint (it is dispatched via session.sendTransaction)')
})

test('wallet page does not render the chrome Connect button or related markup', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x1',
    message: 'hello',
    purpose: 'create-agent',
  })
  assert.doesNotMatch(page, /id="chrome-connect"/)
  assert.doesNotMatch(page, /id="chrome-connect-label"/)
  assert.doesNotMatch(page, /chromeConnect/)
  assert.doesNotMatch(page, /chrome-connect/)
  assert.doesNotMatch(page, /Tap Connect/)
  assert.doesNotMatch(page, /awaiting-connect/)
})

test('wallet page auto-fires the wallet flow on mount for non-session flows', () => {
  const page = __testWalletPage('ethagent wallet signature', 'hidden-token', {
    kind: 'sign',
    chainIdHex: '0x1',
    message: 'hello',
    purpose: 'create-agent',
  })
  assert.match(page, /function bootWallet[\s\S]*?runWalletFlow\(\)/)
})

test('session-wait flow stays auto-driven via startSessionMode', () => {
  const page = __testWalletPage('ethagent wallet session', 'hidden-token', {
    kind: 'session-wait',
  })
  assert.match(page, /kind === "session-wait"[\s\S]*?startSessionMode\(\)/)
  assert.doesNotMatch(page, /hideChromeConnect/)
})

test('session lifecycle sign prompts tell users to keep the wallet page open', () => {
  const page = readWalletPageSource()

  assert.match(page, /function hasNextLifecyclePrompt/)
  assert.match(page, /Keep this page open\. The next wallet step will appear here\./)
  assert.match(page, /config\.kind === "sign"[\s\S]*hasNextLifecyclePrompt\(\) \? nextLifecycleHint\(\) : "Returning to terminal\."/)
  assert.match(page, /hasNextLifecyclePrompt\(\) \? nextLifecycleHint\(\) : "This tab will close shortly\."/)
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

test('shipped wallet page does not depend on removed manual preview assets', () => {
  const wallet = readWalletPageSource()

  assert.doesNotMatch(wallet, /tweaks-panel/)
  assert.doesNotMatch(wallet, /wallet-preview/)
  assert.doesNotMatch(wallet, /test\/manual/)
})

test('wallet page splits snapshot saves into owner/operator/connected variants and removes ambiguous purposes', () => {
  const wallet = readWalletPageSource()

  assert.match(wallet, /"update-snapshot-owner":/)
  assert.match(wallet, /"update-snapshot-operator":/)
  assert.match(wallet, /"update-snapshot-connected":/)
  assert.match(wallet, /"update-profile-owner":/)
  assert.match(wallet, /"update-profile-operator":/)
  assert.match(wallet, /"update-profile-connected":/)
  assert.doesNotMatch(wallet, /"update-snapshot":\s*{/)
  assert.doesNotMatch(wallet, /"update-profile":\s*{/)
  assert.doesNotMatch(wallet, /"Sign With Wallet"/)
})

test('wallet page throws instead of silently rendering a generic prompt for unknown purposes', () => {
  const wallet = readWalletPageSource()

  assert.match(wallet, /refusing to render generic wallet prompt/)
})

test('operator-wallet snapshot save renders Sign With Operator Wallet copy', () => {
  const page = __testWalletPage('ethagent wallet request', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x2105',
    purpose: 'update-snapshot-operator',
    message: 'snapshot save',
  })

  assert.match(page, /Operator Wallet: Save Snapshot/)
  assert.match(page, /Sign With Operator Wallet/)
  assert.doesNotMatch(page, /Sign With Wallet/)
})

test('owner-required snapshot save renders Sign With Owner Wallet copy', () => {
  const page = __testWalletPage('ethagent wallet request', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x2105',
    purpose: 'update-snapshot-owner',
    message: 'snapshot save',
  })

  assert.match(page, /Owner Wallet Required/)
  assert.match(page, /Sign With Owner Wallet/)
})

test('simple-mode snapshot save renders Sign With Connected Wallet copy', () => {
  const page = __testWalletPage('ethagent wallet request', 'hidden-token', {
    kind: 'sign-transaction',
    chainIdHex: '0x2105',
    purpose: 'update-snapshot-connected',
    message: 'snapshot save',
  })

  assert.match(page, /Save Snapshot/)
  assert.match(page, /Sign With Connected Wallet/)
})

test('browser wallet session keeps one localhost URL across multiple prompts', async () => {
  const session = await openBrowserWalletSession({})
  try {
    assert.match(session.url, /^http:\/\/localhost:\d+\/$/)
    const firstUrl = session.url

    const page = await fetch(session.url).then(r => r.text())
    assert.match(page, /"kind":"session-wait"/)

    const cancelled1 = session.requestSignature({
      chainId: 1,
      message: 'first prompt',
      timeoutMs: 3_000,
      flowId: 'ens-clear',
      flowStep: 1,
    }).then(() => null, err => err as Error)

    await new Promise(r => setTimeout(r, 50))
    const cancelRes1 = await fetch(new URL('/cancel', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'ignore' }),
    })
    assert.equal(cancelRes1.status, 409, 'cancel without correct token should be rejected')

    const events1 = await fetch(new URL('/events', session.url))
    const reader = events1.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (!buf.includes('event: prompt')) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
    }
    void reader.cancel()
    const tokenMatch = buf.match(/"sessionToken":"([^"]+)"/)
    assert.ok(tokenMatch, 'session prompt should advertise its sessionToken via SSE')
    const sessionToken = tokenMatch![1]

    await fetch(new URL('/cancel', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken }),
    })
    const err1 = await cancelled1
    assert.match(err1?.message ?? '', /cancelled/)

    assert.equal(session.url, firstUrl, 'second prompt must reuse the same localhost URL')
  } finally {
    await session.close()
  }
})

test('browser wallet session.requestSignatureAndTransaction completes through one popup session', async () => {
  const session = await openBrowserWalletSession({})
  try {
    const cancelled = session.requestSignatureAndTransaction({
      chainId: 1,
      message: 'identity update',
      timeoutMs: 3_000,
      flowId: 'ens-register',
      flowStep: 2,
      prepareTransaction: async () => ({
        to: '0x0000000000000000000000000000000000000001',
        data: '0xabcd',
        prepared: { tag: 'unit' as const },
      }),
    }).then(() => null, err => err as Error)

    const events = await fetch(new URL('/events', session.url))
    const reader = events.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (!buf.includes('event: prompt')) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
    }
    void reader.cancel()
    assert.match(buf, /"kind":"sign-transaction"/)
    assert.match(buf, /"flowId":"ens-register"/)
    assert.match(buf, /"flowStep":2/)
    const sessionToken = buf.match(/"sessionToken":"([^"]+)"/)![1]

    await fetch(new URL('/cancel', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken }),
    })
    const err = await cancelled
    assert.match(err?.message ?? '', /cancelled/)
  } finally {
    await session.close()
  }
})
