import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { getConfigDir, ensureConfigDir, type ProviderId } from '../config/store.js'

const KEYTAR_SERVICE = 'ethagent'

type Keytar = {
  getPassword: (service: string, account: string) => Promise<string | null>
  setPassword: (service: string, account: string, password: string) => Promise<void>
  deletePassword: (service: string, account: string) => Promise<boolean>
}

let keytarCache: Keytar | null | undefined

async function loadKeytar(): Promise<Keytar | null> {
  if (keytarCache !== undefined) return keytarCache
  try {
    const modulePath: string = 'keytar'
    const mod = (await import(modulePath)) as { default?: Keytar } & Partial<Keytar>
    const api = mod.default ?? (mod as Keytar)
    if (typeof api.getPassword !== 'function'
      || typeof api.setPassword !== 'function'
      || typeof api.deletePassword !== 'function') {
      throw new Error('keytar module shape unexpected')
    }
    await api.getPassword(KEYTAR_SERVICE, '__ethagent_probe__')
    keytarCache = api
    return api
  } catch {
    keytarCache = null
    return null
  }
}

function saltPath(): string { return path.join(getConfigDir(), '.salt') }
function keysPath(): string { return path.join(getConfigDir(), 'keys.enc') }

async function atomicWrite(file: string, data: string, mode = 0o600): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data, { encoding: 'utf8', mode })
  await fs.rename(tmp, file)
}

async function loadSalt(): Promise<Buffer> {
  await ensureConfigDir()
  try {
    const b64 = await fs.readFile(saltPath(), 'utf8')
    return Buffer.from(b64.trim(), 'base64')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const salt = crypto.randomBytes(32)
    await atomicWrite(saltPath(), salt.toString('base64'))
    return salt
  }
}

async function deriveKey(): Promise<Buffer> {
  const salt = await loadSalt()
  const material = `${os.hostname()}::${os.userInfo().username}`
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(material, salt, 32, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

async function readEncryptedFile(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(keysPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') result[k] = v
      }
      return result
    }
    return {}
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return {}
  }
}

async function writeEncryptedFile(entries: Record<string, string>): Promise<void> {
  await ensureConfigDir()
  await atomicWrite(keysPath(), JSON.stringify(entries, null, 2))
}

function encryptValue(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, enc]).toString('base64')
}

function decryptValue(key: Buffer, payload: string): string | null {
  try {
    const buf = Buffer.from(payload, 'base64')
    if (buf.length < 12 + 16 + 1) return null
    const iv = buf.subarray(0, 12)
    const authTag = buf.subarray(12, 28)
    const ct = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const dec = Buffer.concat([decipher.update(ct), decipher.final()])
    return dec.toString('utf8')
  } catch {
    return null
  }
}

export type KeyBackend = 'keyring' | 'encrypted-file'

export async function getKey(provider: ProviderId): Promise<string | null> {
  const keytar = await loadKeytar()
  if (keytar) {
    const v = await keytar.getPassword(KEYTAR_SERVICE, provider)
    return v ?? null
  }
  const file = await readEncryptedFile()
  const payload = file[provider]
  if (!payload) return null
  const key = await deriveKey()
  return decryptValue(key, payload)
}

export async function setKey(provider: ProviderId, value: string): Promise<KeyBackend> {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('key value is empty')
  const keytar = await loadKeytar()
  if (keytar) {
    await keytar.setPassword(KEYTAR_SERVICE, provider, trimmed)
    return 'keyring'
  }
  const [key, file] = await Promise.all([deriveKey(), readEncryptedFile()])
  file[provider] = encryptValue(key, trimmed)
  await writeEncryptedFile(file)
  return 'encrypted-file'
}

export async function rmKey(provider: ProviderId): Promise<void> {
  const keytar = await loadKeytar()
  if (keytar) {
    await keytar.deletePassword(KEYTAR_SERVICE, provider)
    return
  }
  const file = await readEncryptedFile()
  if (provider in file) {
    delete file[provider]
    await writeEncryptedFile(file)
  }
}

export async function whichBackend(): Promise<KeyBackend> {
  return (await loadKeytar()) ? 'keyring' : 'encrypted-file'
}

export async function hasKey(provider: ProviderId): Promise<boolean> {
  const value = await getKey(provider)
  return value !== null && value.length > 0
}
