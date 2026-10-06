import test from 'node:test'
import assert from 'node:assert/strict'
import { resetHostStatsForTest } from '../../../src/net/adaptive.js'
import { resetIpfsDiscoveryForTest } from '../../../src/identity/storage/ipfsRead.js'
import { advance, flush, track } from '../../support/time.js'
import {
  addToIpfs,
  addFileToIpfs,
  catFromIpfs,
  extractPinataJwt,
  type IpfsAddResult,
  PINATA_AUTH_TEST_URL,
  PINATA_UPLOAD_API_URL,
  validatePinataJwt,
} from '../../../src/identity/storage/ipfs.js'

const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwaW5hdGEifQ.signature'

// Assigning undefined to process.env stores the string "undefined", which would leak
// into every later test as a real gateway or credential.
function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name]
  else process.env[name] = previous
}

test('IPFS add calls add?pin=true and returns the CID', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    calls.push(String(input))
    return new Response(JSON.stringify({ Hash: 'bafy-test-cid' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const result = await addToIpfs('http://127.0.0.1:5001', '{"ok":true}', fetchImpl)
  assert.deepEqual(result, { cid: 'bafy-test-cid', pinVerified: true, provider: 'ipfs' })
  assert.equal(calls[0], 'http://127.0.0.1:5001/api/v0/add?pin=true')
})

test('IPFS cat calls cat endpoint with CID arg', async () => {
  const calls: string[] = []
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    calls.push(String(input))
    return new Response(new TextEncoder().encode('backup'), { status: 200 })
  }

  const body = await catFromIpfs('http://127.0.0.1:5001/', 'bafy cid', fetchImpl)
  assert.equal(new TextDecoder().decode(body), 'backup')
  assert.equal(calls[0], 'http://127.0.0.1:5001/api/v0/cat?arg=bafy%20cid')
})

type RecordedCall = { input: string; auth?: string; method: string; form?: FormData }

function authOf(init?: RequestInit): string | undefined {
  if (!init?.headers) return undefined
  return new Headers(init.headers as HeadersInit).get('authorization') ?? undefined
}

// Models Pinata: the upload endpoint returns a CID, and the files API lists it
// once `listed` says so. Anything else is a gateway read.
function pinataStub(cid: string, options: { listed?: () => boolean | null; gateway?: () => Response } = {}) {
  const calls: RecordedCall[] = []
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const call: RecordedCall = { input: url, method, ...(authOf(init) ? { auth: authOf(init) } : {}) }
    calls.push(call)
    if (url === PINATA_UPLOAD_API_URL) {
      call.form = await new Request(url, init).formData()
      return Response.json({ data: { cid } })
    }
    if (url.startsWith('https://api.pinata.cloud/v3/files/public')) {
      const listed = options.listed ? options.listed() : true
      if (listed === null) return new Response('forbidden', { status: 403 })
      return Response.json({ data: { files: listed ? [{ cid }] : [] } })
    }
    return options.gateway ? options.gateway() : new Response('not found', { status: 404 })
  }
  return { calls, fetchImpl }
}

test('Pinata upload uses bearer auth and returns data.cid', async () => {
  const prevJwt = process.env.PINATA_JWT
  process.env.PINATA_JWT = 'test-jwt'
  const { calls, fetchImpl } = pinataStub('bafy-pinata-cid')
  try {
    const result = await addToIpfs(PINATA_UPLOAD_API_URL, '{"ok":true}', fetchImpl)
    assert.deepEqual(result, { cid: 'bafy-pinata-cid', pinVerified: true, provider: 'pinata' })
    assert.equal(calls[0]?.input, PINATA_UPLOAD_API_URL)
    assert.equal(calls[0]?.auth, 'Bearer test-jwt')
    assert.equal(calls[0]?.form?.get('network'), 'public')
  } finally {
    restoreEnv('PINATA_JWT', prevJwt)
  }
})

test('Pinata image upload sends filename and content type with bearer auth', async () => {
  const { calls, fetchImpl } = pinataStub('bafy-image-cid')
  const result = await addFileToIpfs(PINATA_UPLOAD_API_URL, new Uint8Array([1, 2, 3]), 'agent.png', 'image/png', fetchImpl, {
    pinataJwt: TEST_JWT,
  })

  assert.deepEqual(result, { cid: 'bafy-image-cid', pinVerified: true, provider: 'pinata' })
  assert.equal(calls[0]?.input, PINATA_UPLOAD_API_URL)
  assert.equal(calls[0]?.auth, `Bearer ${TEST_JWT}`)
  const file = calls[0]?.form?.get('file') as File | null
  assert.equal(file?.name, 'agent.png')
  assert.equal(file?.type, 'image/png')
  assert.deepEqual(new Uint8Array(await file!.arrayBuffer()), new Uint8Array([1, 2, 3]))
})

test('a pin is confirmed from Pinata\'s own record, with the upload credential and no gateway HEAD', async () => {
  const { calls, fetchImpl } = pinataStub('bafy-listed-cid')
  const result = await addToIpfs(PINATA_UPLOAD_API_URL, '{}', fetchImpl, { pinataJwt: TEST_JWT })
  assert.equal(result.pinVerified, true)
  const check = calls.find(call => call.input.startsWith('https://api.pinata.cloud/v3/files/public'))
  assert.ok(check, 'the files API must be asked about the new CID')
  assert.match(check!.input, /cid=bafy-listed-cid/)
  assert.equal(check!.auth, `Bearer ${TEST_JWT}`)
  assert.ok(!calls.some(call => call.method === 'HEAD'), 'no HEAD request is ever sent')
  assert.equal(calls.length, 2, 'a listed pin needs no gateway read')
})

test('a pin Pinata cannot vouch for is confirmed by reading it back from a gateway', async () => {
  const readable = pinataStub('bafy-readable-cid', { listed: () => null, gateway: () => new Response('{}', { status: 200 }) })
  const confirmed = await addToIpfs(PINATA_UPLOAD_API_URL, '{}', readable.fetchImpl, { pinataJwt: TEST_JWT })
  assert.equal(confirmed.pinVerified, true)
  assert.ok(readable.calls.some(call => call.input.includes('/ipfs/bafy-readable-cid')), 'the fallback reads the CID through a gateway')

  const missing = pinataStub('bafy-missing-cid', { listed: () => null })
  const unconfirmed = await addToIpfs(PINATA_UPLOAD_API_URL, '{}', missing.fetchImpl, { pinataJwt: TEST_JWT })
  assert.equal(unconfirmed.pinVerified, false, 'a pin nobody can confirm is reported as unverified')
})

test('a rejected Pinata upload reports its status instead of a pin result', async () => {
  const fetchImpl = async (): Promise<Response> => new Response('limit', { status: 403, statusText: 'Forbidden' })
  await assert.rejects(
    addToIpfs(PINATA_UPLOAD_API_URL, '{}', fetchImpl, { pinataJwt: TEST_JWT }),
    /Pinata refused the upload \(403 Forbidden\)/,
  )
})

test('an upload declares its exact length and goes out in pieces', async () => {
  const content = new Uint8Array(200 * 1024).map((_, index) => index % 251)
  let declared = 0
  let duplex: unknown
  const pieces: number[] = []
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) !== PINATA_UPLOAD_API_URL) return Response.json({ data: { files: [{ cid: 'bafy-sized-cid' }] } })
    declared = Number(new Headers(init?.headers as HeadersInit).get('content-length'))
    duplex = (init as { duplex?: unknown }).duplex
    const reader = (init!.body as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      pieces.push(next.value.byteLength)
    }
    return Response.json({ data: { cid: 'bafy-sized-cid' } })
  }
  await addFileToIpfs(PINATA_UPLOAD_API_URL, content, 'snapshot.bin', 'application/octet-stream', fetchImpl, { pinataJwt: TEST_JWT })
  const sent = pieces.reduce((total, size) => total + size, 0)
  assert.ok(sent > content.byteLength, 'the multipart framing is part of the body')
  assert.equal(declared, sent, 'Content-Length matches the bytes on the wire, so the request is never chunked')
  assert.equal(duplex, 'half')
  assert.ok(pieces.length >= 4, 'a 200 KiB upload goes out in several pieces')
  assert.ok(pieces.every(size => size <= 64 * 1024))
})

test('a pin is confirmed once Pinata lists it, pausing longer between each look', async t => {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let looks = 0
  const { calls, fetchImpl } = pinataStub('bafy-slow-index-cid', {
    listed: () => {
      looks += 1
      return looks >= 3
    },
  })
  const upload = track(addToIpfs(PINATA_UPLOAD_API_URL, '{}', fetchImpl, { pinataJwt: TEST_JWT }))
  await flush()
  await flush()
  assert.equal(looks, 1)
  await advance(t, 1_000)
  assert.equal(looks, 2, 'second look after one bound')
  await advance(t, 1_750)
  assert.equal(looks, 2)
  await advance(t, 250)
  assert.equal(looks, 3, 'third look after the doubled bound')
  await flush()
  assert.equal(upload.settled, true)
  assert.equal(upload.error, undefined)
  assert.ok(!calls.some(call => call.input.includes('/ipfs/')), 'Pinata\'s own record was enough')
})

test('a pin Pinata never lists is still confirmed by reading it back', async t => {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { calls, fetchImpl } = pinataStub('bafy-unlisted-cid', {
    listed: () => false,
    gateway: () => new Response('{}', { status: 200 }),
  })
  let result: IpfsAddResult | undefined
  const upload = track(addToIpfs(PINATA_UPLOAD_API_URL, '{}', fetchImpl, { pinataJwt: TEST_JWT }).then(value => { result = value }))
  await flush()
  await advance(t, 30_750)
  assert.equal(upload.settled, false, 'still inside the backoff')
  await advance(t, 250)
  await flush()
  assert.equal(upload.settled, true)
  assert.equal(result?.pinVerified, true)
  assert.equal(calls.filter(call => call.input.startsWith('https://api.pinata.cloud/v3/files/public')).length, 6)
  assert.ok(calls.some(call => call.input.includes('/ipfs/bafy-unlisted-cid')))
})

test('Pinata JWT extractor accepts raw JWT and copy-all output', () => {
  assert.equal(extractPinataJwt(TEST_JWT), TEST_JWT)
  assert.equal(extractPinataJwt([
    'API Key',
    'f6ce52d7aecdace366d',
    'API Secret',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'JWT (secret access token)',
    TEST_JWT,
  ].join('\n')), TEST_JWT)
})

test('Pinata JWT extractor rejects API key and secret fields', () => {
  assert.throws(() => extractPinataJwt('API Key: f6ce52d7aecdace366d'), /Use the JWT, not the API key or secret/)
  assert.throws(() => extractPinataJwt('API Secret: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), /Use the JWT, not the API key or secret/)
  assert.throws(() => extractPinataJwt('aaa.bbb.ccc'), /Paste the JWT from Pinata/)
  assert.throws(() => extractPinataJwt('not a token'), /Paste the JWT from Pinata/)
})

test('Pinata JWT validation calls the authentication endpoint', async () => {
  const calls: Array<{ input: string; auth?: string }> = []
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      input: String(input),
      auth: init?.headers instanceof Headers
        ? init.headers.get('authorization') ?? undefined
        : (init?.headers as Record<string, string> | undefined)?.Authorization,
    })
    return new Response(JSON.stringify({ message: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await assert.doesNotReject(validatePinataJwt(TEST_JWT, fetchImpl))
  assert.equal(calls[0]?.input, PINATA_AUTH_TEST_URL)
  assert.equal(calls[0]?.auth, `Bearer ${TEST_JWT}`)
})

test('Pinata JWT validation rejects unauthenticated credentials', async () => {
  const fetchImpl = async (): Promise<Response> => new Response('{}', { status: 401, statusText: 'Unauthorized' })
  await assert.rejects(validatePinataJwt(TEST_JWT, fetchImpl), /Pinata rejected this JWT/)
})

test('Pinata fetch reads from configured gateway', async () => {
  const prevGateway = process.env.PINATA_GATEWAY_URL
  process.env.PINATA_GATEWAY_URL = 'https://example-gateway.mypinata.cloud'
  const calls: string[] = []
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    calls.push(String(input))
    return new Response(new TextEncoder().encode('backup'), { status: 200 })
  }
  try {
    const body = await catFromIpfs(PINATA_UPLOAD_API_URL, 'bafy cid', fetchImpl)
    assert.equal(new TextDecoder().decode(body), 'backup')
    assert.equal(calls[0], 'https://example-gateway.mypinata.cloud/ipfs/bafy%20cid')
  } finally {
    restoreEnv('PINATA_GATEWAY_URL', prevGateway)
  }
})
