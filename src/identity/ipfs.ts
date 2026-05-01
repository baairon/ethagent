export const PINATA_UPLOAD_API_URL = 'https://uploads.pinata.cloud/v3/files'
export const PINATA_AUTH_TEST_URL = 'https://api.pinata.cloud/data/testAuthentication'
export const DEFAULT_PINATA_GATEWAY_URL = 'https://gateway.pinata.cloud'
export const DEFAULT_IPFS_API_URL = process.env.ETHAGENT_IPFS_API_URL?.trim() || PINATA_UPLOAD_API_URL

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type IpfsClient = {
  apiUrl: string
  add: (content: string | Uint8Array) => Promise<IpfsAddResult>
  cat: (cid: string) => Promise<Uint8Array>
}

export type IpfsAddResult = {
  cid: string
  pinVerified: boolean
  provider: 'pinata' | 'ipfs'
}

type IpfsOptions = {
  pinataJwt?: string
}

export function createIpfsClient(apiUrl = DEFAULT_IPFS_API_URL, fetchImpl: FetchLike = fetch, options: IpfsOptions = {}): IpfsClient {
  const base = normalizeApiUrl(apiUrl)
  return {
    apiUrl: base,
    add: content => addToIpfs(base, content, fetchImpl, options),
    cat: cid => catFromIpfs(base, cid, fetchImpl),
  }
}

export function needsPinataJwt(apiUrl = DEFAULT_IPFS_API_URL, options: IpfsOptions = {}): boolean {
  return isPinataUploadUrl(apiUrl) && !pinataJwt(options)
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
    response = await fetchImpl(PINATA_AUTH_TEST_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
    })
  } catch {
    throw new Error('Could not validate Pinata JWT. Check your connection, then try again.')
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
  const response = await fetchImpl(`${normalizeApiUrl(apiUrl)}/api/v0/add?pin=true`, {
    method: 'POST',
    body,
  })
  if (!response.ok) throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`)
  const data = await response.json() as { Hash?: string; Cid?: string; Name?: string }
  const cid = data.Hash ?? data.Cid
  if (!cid) throw new Error('IPFS add response did not include a CID')
  return { cid, pinVerified: true, provider: 'ipfs' }
}

export async function catFromIpfs(
  apiUrl: string,
  cid: string,
  fetchImpl: FetchLike = fetch,
): Promise<Uint8Array> {
  if (isPinataUploadUrl(apiUrl)) return catFromPinata(cid, fetchImpl)
  const arg = encodeURIComponent(cid.trim())
  const response = await fetchImpl(`${normalizeApiUrl(apiUrl)}/api/v0/cat?arg=${arg}`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error(`IPFS cat failed: ${response.status} ${response.statusText}`)
  return new Uint8Array(await response.arrayBuffer())
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
  const response = await fetchImpl(normalizeApiUrl(apiUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body,
  })
  if (!response.ok) throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}`)
  const data = await response.json() as { data?: { cid?: string }; IpfsHash?: string; Hash?: string; Cid?: string }
  const cid = data.data?.cid ?? data.IpfsHash ?? data.Hash ?? data.Cid
  if (!cid) throw new Error('IPFS upload response did not include a CID')
  return { cid, pinVerified: true, provider: 'pinata' }
}

function pinataJwt(options: IpfsOptions): string | undefined {
  return options.pinataJwt?.trim() || process.env.PINATA_JWT?.trim() || undefined
}

async function catFromPinata(cid: string, fetchImpl: FetchLike): Promise<Uint8Array> {
  const gateway = normalizeApiUrl(process.env.PINATA_GATEWAY_URL?.trim() || DEFAULT_PINATA_GATEWAY_URL)
  const path = cid.trim().split('/').map(part => encodeURIComponent(part)).join('/')
  const response = await fetchImpl(`${gateway}/ipfs/${path}`)
  if (!response.ok) throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`)
  return new Uint8Array(await response.arrayBuffer())
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
    const json = Buffer.from(base64UrlToBase64(value), 'base64').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  return normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
}
