import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addToIpfs,
  addFileToIpfs,
  catFromIpfs,
  extractPinataJwt,
  PINATA_AUTH_TEST_URL,
  PINATA_UPLOAD_API_URL,
  validatePinataJwt,
} from '../../../src/identity/storage/ipfs.js'

const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwaW5hdGEifQ.signature'

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

test('Pinata upload uses bearer auth and returns data.cid', async () => {
  const prevJwt = process.env.PINATA_JWT
  process.env.PINATA_JWT = 'test-jwt'
  const calls: Array<{ input: string; auth?: string; method?: string }> = []
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      input: String(input),
      auth: init?.headers instanceof Headers
        ? init.headers.get('authorization') ?? undefined
        : (init?.headers as Record<string, string> | undefined)?.Authorization,
      method: init?.method,
    })
    if (init?.method === 'HEAD') {
      return new Response(null, { status: 200 })
    }
    return new Response(JSON.stringify({ data: { cid: 'bafy-pinata-cid' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await addToIpfs(PINATA_UPLOAD_API_URL, '{"ok":true}', fetchImpl)
    assert.deepEqual(result, { cid: 'bafy-pinata-cid', pinVerified: true, provider: 'pinata' })
    assert.equal(calls[0]?.input, PINATA_UPLOAD_API_URL)
    assert.equal(calls[0]?.auth, 'Bearer test-jwt')
  } finally {
    process.env.PINATA_JWT = prevJwt
  }
})

test('Pinata image upload sends filename and content type with bearer auth', async () => {
  const calls: Array<{ input: string; auth?: string; file?: File | null; method?: string }> = []
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'HEAD') {
      calls.push({ input: String(input), method: 'HEAD' })
      return new Response(null, { status: 200 })
    }
    const body = init?.body as FormData
    calls.push({
      input: String(input),
      auth: init?.headers instanceof Headers
        ? init.headers.get('authorization') ?? undefined
        : (init?.headers as Record<string, string> | undefined)?.Authorization,
      file: body.get('file') as File | null,
    })
    return new Response(JSON.stringify({ data: { cid: 'bafy-image-cid' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const result = await addFileToIpfs(PINATA_UPLOAD_API_URL, new Uint8Array([1, 2, 3]), 'agent.png', 'image/png', fetchImpl, {
    pinataJwt: TEST_JWT,
  })

  assert.deepEqual(result, { cid: 'bafy-image-cid', pinVerified: true, provider: 'pinata' })
  assert.equal(calls[0]?.input, PINATA_UPLOAD_API_URL)
  assert.equal(calls[0]?.auth, `Bearer ${TEST_JWT}`)
  assert.equal(calls[0]?.file?.name, 'agent.png')
  assert.equal(calls[0]?.file?.type, 'image/png')
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
    process.env.PINATA_GATEWAY_URL = prevGateway
  }
})
