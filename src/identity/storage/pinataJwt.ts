import { getSecret, hasSecret, rmSecret, setSecret, type KeyBackend } from '../../storage/secrets.js'
import { extractPinataJwt, validatePinataJwt, type FetchLike } from './ipfs.js'

const ACCOUNT = 'pinata:jwt'

let cached: string | null | undefined

type SavePinataJwtOptions = {
  fetchImpl?: FetchLike
  validate?: boolean
}

export async function getPinataJwt(): Promise<string | null> {
  return getSecret(ACCOUNT)
}

export async function hasPinataJwt(): Promise<boolean> {
  return hasSecret(ACCOUNT)
}

export async function savePinataJwt(input: string, options: SavePinataJwtOptions = {}): Promise<{ jwt: string; backend: KeyBackend }> {
  const jwt = extractPinataJwt(input)
  if (options.validate !== false) await validatePinataJwt(jwt, options.fetchImpl)
  const backend = await setSecret(ACCOUNT, jwt)
  cached = jwt
  return { jwt, backend }
}

export async function clearPinataJwt(): Promise<void> {
  await rmSecret(ACCOUNT)
  cached = null
}

export async function resolvePinataJwt(): Promise<string | undefined> {
  if (cached !== undefined) return cached ?? envJwt()
  cached = await getSecret(ACCOUNT)
  return cached ?? envJwt()
}

export async function resolveValidatedPinataJwt(fetchImpl: FetchLike = fetch): Promise<string | undefined> {
  const jwt = await resolvePinataJwt()
  if (!jwt) return undefined
  return validatePinataJwt(jwt, fetchImpl)
}

export function invalidatePinataJwtCache(): void {
  cached = undefined
}

function envJwt(): string | undefined {
  const v = process.env.PINATA_JWT?.trim()
  return v ? v : undefined
}
