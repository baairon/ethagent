import { getSecret, hasSecret, rmSecret, setSecret, type KeyBackend } from '../storage/secrets.js'
import { extractPinataJwt } from './ipfs.js'

const ACCOUNT = 'pinata:jwt'

let cached: string | null | undefined

export async function getPinataJwt(): Promise<string | null> {
  return getSecret(ACCOUNT)
}

export async function hasPinataJwt(): Promise<boolean> {
  return hasSecret(ACCOUNT)
}

export async function savePinataJwt(input: string): Promise<{ jwt: string; backend: KeyBackend }> {
  const jwt = extractPinataJwt(input)
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

export function invalidatePinataJwtCache(): void {
  cached = undefined
}

function envJwt(): string | undefined {
  const v = process.env.PINATA_JWT?.trim()
  return v ? v : undefined
}
