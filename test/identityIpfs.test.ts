import test from 'node:test'
import assert from 'node:assert/strict'
import { addToIpfs, catFromIpfs, extractPinataJwt, PINATA_UPLOAD_API_URL } from '../src/identity/ipfs.js'

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
  const calls: Array<{ input: string; auth?: string }> = []
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      input: String(input),
      auth: init?.headers instanceof Headers
        ? init.headers.get('authorization') ?? undefined
        : (init?.headers as Record<string, string> | undefined)?.Authorization,
    })
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
  assert.throws(() => extractPinataJwt('not a token'), /Paste the JWT from Pinata/)
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
