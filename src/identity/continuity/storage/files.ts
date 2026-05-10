import fs from 'node:fs/promises'
import { atomicWriteText } from '../../../storage/atomicWrite.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles } from '../envelope.js'
import { defaultContinuityFiles } from './defaults.js'
import { continuityVaultRef } from './paths.js'
import type { ContinuityVaultRef } from './types.js'

export async function ensureContinuityVault(identity: EthagentIdentity): Promise<ContinuityVaultRef> {
  const ref = continuityVaultRef(identity)
  await fs.mkdir(ref.dir, { recursive: true, mode: 0o700 })
  return ref
}

export async function ensureContinuityFiles(identity: EthagentIdentity): Promise<ContinuityFiles> {
  const ref = await ensureContinuityVault(identity)
  const defaults = defaultContinuityFiles(identity)
  await writeMissingPrivateFile(ref.soulPath, defaults['SOUL.md'])
  await writeMissingPrivateFile(ref.memoryPath, defaults['MEMORY.md'])
  return readContinuityFiles(identity)
}

export async function readContinuityFiles(identity: EthagentIdentity): Promise<ContinuityFiles> {
  const ref = await ensureContinuityVault(identity)
  const defaults = defaultContinuityFiles(identity)
  return {
    'SOUL.md': await readOrDefault(ref.soulPath, defaults['SOUL.md']),
    'MEMORY.md': await readOrDefault(ref.memoryPath, defaults['MEMORY.md']),
  }
}

export async function writeContinuityFiles(identity: EthagentIdentity, files: ContinuityFiles): Promise<ContinuityVaultRef> {
  const ref = await ensureContinuityVault(identity)
  await atomicWriteText(ref.soulPath, ensureTrailingNewline(files['SOUL.md']), { mode: 0o600 })
  await atomicWriteText(ref.memoryPath, ensureTrailingNewline(files['MEMORY.md']), { mode: 0o600 })
  return ref
}

async function writeMissingPrivateFile(file: string, content: string): Promise<void> {
  if (await exists(file)) return
  await atomicWriteText(file, ensureTrailingNewline(content), { mode: 0o600 })
}

export async function readOrDefault(file: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export async function statIfExists(file: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.stat(file)
  } catch {
    return null
  }
}

export function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
