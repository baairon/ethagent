import { assertCidMatchesContent } from './cid.js'

export const PINATA_UPLOAD_API_URL = 'https://uploads.pinata.cloud/v3/files'
export const PINATA_AUTH_TEST_URL = 'https://api.pinata.cloud/data/testAuthentication'
const DEFAULT_PINATA_GATEWAY_URL = 'https://gateway.pinata.cloud'
export const DEFAULT_IPFS_API_URL = process.env.ETHAGENT_IPFS_API_URL?.trim() || PINATA_UPLOAD_API_URL

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

const CAT_TIMEOUT_MS = 30_000
const HEAD_TIMEOUT_MS = 15_000
const JWT_TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 120_000

function withTimeout(ms: number, signal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(signal?.reason)
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${ms}ms`)), ms)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    clear: (): void => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
  }
}

export type IpfsAddResult = {
  cid: string
  pinVerified: boolean
  provider: 'pinata' | 'ipfs'
}

type IpfsOptions = {
  pinataJwt?: string
}

export class PinataUploadError extends Error {
  readonly status: number
  readonly statusText: string
  constructor(status: number, statusText: string) {
    super(pinataUploadErrorMessage(status, statusText))
    this.name = 'PinataUploadError'
    this.status = status
    this.statusText = statusText
  }
}

function pinataUploadErrorMessage(status: number, statusText: string): string {
  const code = statusText ? `${status} ${statusText}` : String(status)
  if (status === 401) return `Pinata rejected the upload (${code}): the storage credential is invalid or expired.`
  if (status === 403) return `Pinata refused the upload (${code}): your account is likely at its file or storage limit.`
  if (status === 429) return `Pinata is rate-limiting uploads (${code}): too many requests in a short window.`
  if (status === 413) return `Pinata rejected the upload (${code}): the snapshot is larger than your plan allows.`
  return `IPFS upload failed: ${code}.`
}

export function extractPinataJwt(input: string): string {
  const trimmed = input.trim()
  const matches = trimmed.match(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g) ?? []
  const jwt = matches.find(isWellFormedJwt)
  if (jwt) return jwt
  if (/api\s*key|api\s*secret|secret\s*key/i.test(trimmed)) {
    throw new Error('Use the JWT, not the API key or secret.')
  }
  throw new Error('Paste the JWT from Pinata.')
}

export async function validatePinataJwt(
  input: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const jwt = extractPinataJwt(input)
  const t = withTimeout(JWT_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchImpl(PINATA_AUTH_TEST_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      signal: t.signal,
    })
  } catch {
    throw new Error('Could not validate Pinata JWT. Check your connection, then try again.')
  } finally {
    t.clear()
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Pinata rejected this JWT. Paste a valid Pinata JWT.')
  }
  if (!response.ok) {
    throw new Error(`Pinata credential validation failed: ${response.status} ${response.statusText}`)
  }
  return jwt
}

export async function addToIpfs(
  apiUrl: string,
  content: string | Uint8Array,
  fetchImpl: FetchLike = fetch,
  options: IpfsOptions = {},
): Promise<IpfsAddResult> {
  if (isPinataUploadUrl(apiUrl)) return addToPinata(apiUrl, content, fetchImpl, options)
  return addFileToIpfs(apiUrl, content, 'ethagent-identity-backup.json', 'application/json', fetchImpl, options)
}

export async function addFileToIpfs(
  apiUrl: string,
  content: string | Uint8Array,
  filename: string,
  contentType: string,
  fetchImpl: FetchLike = fetch,
  options: IpfsOptions = {},
): Promise<IpfsAddResult> {
  if (isPinataUploadUrl(apiUrl)) return addFileToPinata(apiUrl, content, filename, contentType, fetchImpl, options)
  const body = new FormData()
  const blobPart: BlobPart = typeof content === 'string'
    ? content
    : new Uint8Array(content).buffer as ArrayBuffer
  const blob = new Blob([blobPart], { type: contentType })
  body.append('file', blob, filename)
  const t = withTimeout(UPLOAD_TIMEOUT_MS)
  let response: Response
  let data: { Hash?: string; Cid?: string; Name?: string }
  try {
    response = await fetchImpl(`${normalizeApiUrl(apiUrl)}/api/v0/add?pin=true`, {
      method: 'POST',
      body,
      signal: t.signal,
    })
    if (!response.ok) throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`)
    data = await response.json() as { Hash?: string; Cid?: string; Name?: string }
  } finally {
    t.clear()
  }
  const cid = data.Hash ?? data.Cid
  if (!cid) throw new Error('IPFS add response did not include a CID')
  return { cid, pinVerified: true, provider: 'ipfs' }
}

export async function catFromIpfs(
  apiUrl: string,
  cid: string,
  fetchImpl: FetchLike = fetch,
  options: { signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  if (isPinataUploadUrl(apiUrl)) {
    const bytes = await catFromPinata(cid, fetchImpl, options.signal)
    assertCidMatchesContent(cid, bytes)
    return bytes
  }
  const arg = encodeURIComponent(cid.trim())
  const t = withTimeout(CAT_TIMEOUT_MS, options.signal)
  try {
    const response = await fetchImpl(`${normalizeApiUrl(apiUrl)}/api/v0/cat?arg=${arg}`, {
      method: 'POST',
      signal: t.signal,
    })
    if (!response.ok) throw new Error(`IPFS cat failed: ${response.status} ${response.statusText}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    assertCidMatchesContent(cid, bytes)
    return bytes
  } finally {
    t.clear()
  }
}

function normalizeApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim() || DEFAULT_IPFS_API_URL
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

async function addToPinata(
  apiUrl: string,
  content: string | Uint8Array,
  fetchImpl: FetchLike,
  options: IpfsOptions,
): Promise<IpfsAddResult> {
  return addFileToPinata(apiUrl, content, 'ethagent-agent-state.json', 'application/json', fetchImpl, options)
}

async function addFileToPinata(
  apiUrl: string,
  content: string | Uint8Array,
  filename: string,
  contentType: string,
  fetchImpl: FetchLike,
  options: IpfsOptions,
): Promise<IpfsAddResult> {
  const jwt = pinataJwt(options)
  if (!jwt) throw new Error('IPFS storage credential is missing')
  const body = new FormData()
  const blobPart: BlobPart = typeof content === 'string'
    ? content
    : new Uint8Array(content).buffer as ArrayBuffer
  const blob = new Blob([blobPart], { type: contentType })
  body.append('network', 'public')
  body.append('file', blob, filename)
  const t = withTimeout(UPLOAD_TIMEOUT_MS)
  let response: Response
  let data: { data?: { cid?: string }; IpfsHash?: string; Hash?: string; Cid?: string }
  try {
    response = await fetchImpl(normalizeApiUrl(apiUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body,
      signal: t.signal,
    })
    if (!response.ok) throw new PinataUploadError(response.status, response.statusText)
    data = await response.json() as { data?: { cid?: string }; IpfsHash?: string; Hash?: string; Cid?: string }
  } finally {
    t.clear()
  }
  const cid = data.data?.cid ?? data.IpfsHash ?? data.Hash ?? data.Cid
  if (!cid) throw new Error('IPFS upload response did not include a CID')
  const verified = await verifyCidReachable(cid, fetchImpl)
  return { cid, pinVerified: verified, provider: 'pinata' }
}

async function verifyCidReachable(
  cid: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  const gateway = normalizeApiUrl(process.env.PINATA_GATEWAY_URL?.trim() || DEFAULT_PINATA_GATEWAY_URL)
  const path = cid.trim().split('/').map(part => encodeURIComponent(part)).join('/')
  const url = `${gateway}/ipfs/${path}`
  for (const delayMs of [0, 1500]) {
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    const t = withTimeout(HEAD_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { method: 'HEAD', signal: t.signal })
      if (response.ok) return true
    } catch {
    } finally {
      t.clear()
    }
  }
  return false
}

function pinataJwt(options: IpfsOptions): string | undefined {
  return options.pinataJwt?.trim() || process.env.PINATA_JWT?.trim() || undefined
}

async function catFromPinata(cid: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<Uint8Array> {
  const gateway = normalizeApiUrl(process.env.PINATA_GATEWAY_URL?.trim() || DEFAULT_PINATA_GATEWAY_URL)
  const path = cid.trim().split('/').map(part => encodeURIComponent(part)).join('/')
  const t = withTimeout(CAT_TIMEOUT_MS, signal)
  try {
    const response = await fetchImpl(`${gateway}/ipfs/${path}`, { signal: t.signal })
    if (!response.ok) throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`)
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    t.clear()
  }
}

export function isPinataUploadUrl(apiUrl: string): boolean {
  try {
    const url = new URL(normalizeApiUrl(apiUrl))
    return url.hostname === 'uploads.pinata.cloud'
      || url.hostname === 'api.pinata.cloud'
  } catch {
    return false
  }
}

function isWellFormedJwt(input: string): boolean {
  const parts = input.split('.')
  if (parts.length !== 3 || parts.some(part => part.length === 0)) return false
  const [header, payload] = parts
  return isJsonObjectBase64Url(header!) && isJsonObjectBase64Url(payload!)
}

function isJsonObjectBase64Url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}
