import { assertCidMatchesContent } from './cid.js'
import { probeIpfs, readIpfs, type IpfsReadProgress } from './ipfsRead.js'
import {
  createAdaptiveFetch,
  hostOf,
  NetError,
  readBody,
  rto,
  sleep,
  withinBackoffCeiling,
  type FetchLike as AdaptiveFetchLike,
} from '../../net/adaptive.js'

export const PINATA_UPLOAD_API_URL = 'https://uploads.pinata.cloud/v3/files'
export const PINATA_AUTH_TEST_URL = 'https://api.pinata.cloud/data/testAuthentication'
const PINATA_FILES_URL = 'https://api.pinata.cloud/v3/files/public'
export const DEFAULT_IPFS_API_URL = process.env.ETHAGENT_IPFS_API_URL?.trim() || PINATA_UPLOAD_API_URL

export type FetchLike = AdaptiveFetchLike

export type IpfsAddResult = {
  cid: string
  pinVerified: boolean
  provider: 'pinata' | 'ipfs'
}

type IpfsOptions = {
  pinataJwt?: string
}

export type IpfsCatOptions = {
  signal?: AbortSignal
  onProgress?: (progress: IpfsReadProgress) => void
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
  let response: Response
  try {
    response = await createAdaptiveFetch(fetchImpl)(PINATA_AUTH_TEST_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    })
  } catch (err: unknown) {
    const reason = err instanceof NetError ? ` (${err.words})` : ''
    throw new Error(`Could not reach Pinata to check the JWT${reason}. Check your connection, then try again.`)
  }
  await response.body?.cancel().catch(() => {})
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
  if (isPinataUploadUrl(apiUrl)) return addFileToPinata(apiUrl, content, 'ethagent-agent-state.json', 'application/json', fetchImpl, options)
  return addFileToIpfs(apiUrl, content, 'ethagent-identity-backup.json', 'application/json', fetchImpl, options)
}

// The size of each piece handed to the socket. It sets how finely upload progress is
// observed, so a slow link is told apart from a dead one. It limits nothing.
const UPLOAD_PIECE_BYTES = 64 * 1024

type Multipart = { body: ReadableStream<Uint8Array>; contentType: string; length: number }

// Encodes the form once so its exact length is known and declared, then streams it in
// pieces. The request stays a plain Content-Length upload on the wire.
async function multipartBody(fields: Array<[string, string | Blob, string?]>): Promise<Multipart> {
  const form = new FormData()
  for (const [name, value, filename] of fields) {
    if (typeof value === 'string') form.append(name, value)
    else form.append(name, value, filename)
  }
  const encoded = new Response(form)
  const contentType = encoded.headers.get('content-type') ?? 'multipart/form-data'
  const bytes = new Uint8Array(await encoded.arrayBuffer())
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(sink) {
      if (offset >= bytes.byteLength) {
        sink.close()
        return
      }
      const end = Math.min(bytes.byteLength, offset + UPLOAD_PIECE_BYTES)
      sink.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
  return { body, contentType, length: bytes.byteLength }
}

function fileBlob(content: string | Uint8Array, contentType: string): Blob {
  const blobPart: BlobPart = typeof content === 'string'
    ? content
    : new Uint8Array(content).buffer as ArrayBuffer
  return new Blob([blobPart], { type: contentType })
}

function streamedPost(headers: Record<string, string>, multipart: Multipart): RequestInit {
  return {
    method: 'POST',
    headers: { ...headers, 'content-type': multipart.contentType, 'content-length': String(multipart.length) },
    body: multipart.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' }
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
  const multipart = await multipartBody([['file', fileBlob(content, contentType), filename]])
  const response = await createAdaptiveFetch(fetchImpl)(
    `${normalizeApiUrl(apiUrl)}/api/v0/add?pin=true`,
    streamedPost({}, multipart),
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`)
  }
  const data = await response.json() as { Hash?: string; Cid?: string; Name?: string }
  const cid = data.Hash ?? data.Cid
  if (!cid) throw new Error('IPFS add response did not include a CID')
  return { cid, pinVerified: true, provider: 'ipfs' }
}

export async function catFromIpfs(
  apiUrl: string,
  cid: string,
  fetchImpl: FetchLike = fetch,
  options: IpfsCatOptions = {},
): Promise<Uint8Array> {
  if (isPinataUploadUrl(apiUrl)) {
    return readIpfs(cid, {
      fetchImpl,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    })
  }
  const arg = encodeURIComponent(cid.trim())
  const response = await createAdaptiveFetch(fetchImpl)(`${normalizeApiUrl(apiUrl)}/api/v0/cat?arg=${arg}`, {
    method: 'POST',
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`IPFS cat failed: ${response.status} ${response.statusText}`)
  }
  const host = hostOf(apiUrl)
  const bytes = await readBody(response, received => options.onProgress?.({ bytes: received, host }))
  assertCidMatchesContent(cid, bytes)
  return bytes
}

function normalizeApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim() || DEFAULT_IPFS_API_URL
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
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
  const multipart = await multipartBody([
    ['network', 'public'],
    ['file', fileBlob(content, contentType), filename],
  ])
  const response = await createAdaptiveFetch(fetchImpl)(
    normalizeApiUrl(apiUrl),
    streamedPost({ Authorization: `Bearer ${jwt}` }, multipart),
  )
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new PinataUploadError(response.status, response.statusText)
  }
  const data = await response.json() as { data?: { cid?: string }; IpfsHash?: string; Hash?: string; Cid?: string }
  const cid = data.data?.cid ?? data.IpfsHash ?? data.Hash ?? data.Cid
  if (!cid) throw new Error('IPFS upload response did not include a CID')
  const verified = await confirmPinned(cid, jwt, fetchImpl)
  return { cid, pinVerified: verified, provider: 'pinata' }
}

async function pinataListsCid(cid: string, jwt: string, fetchImpl: FetchLike): Promise<boolean | null> {
  try {
    const response = await createAdaptiveFetch(fetchImpl)(`${PINATA_FILES_URL}?cid=${encodeURIComponent(cid)}&limit=1`, {
      headers: { Authorization: `Bearer ${jwt}`, accept: 'application/json' },
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return null
    }
    const body = await response.json().catch(() => null) as { data?: { files?: Array<{ cid?: unknown }> } } | null
    const files = body?.data?.files
    if (!Array.isArray(files)) return null
    return files.some(file => file?.cid === cid)
  } catch {
    return null
  }
}

async function confirmPinned(cid: string, jwt: string, fetchImpl: FetchLike): Promise<boolean> {
  const apiHost = hostOf(PINATA_FILES_URL)
  for (let wait = rto(apiHost); ; wait *= 2) {
    const listed = await pinataListsCid(cid, jwt, fetchImpl)
    if (listed === true) return true
    if (listed === null) break
    if (!withinBackoffCeiling(wait * 2)) break
    await sleep(wait)
  }
  return probeIpfs(cid, { fetchImpl })
}

function pinataJwt(options: IpfsOptions): string | undefined {
  return options.pinataJwt?.trim() || process.env.PINATA_JWT?.trim() || undefined
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
