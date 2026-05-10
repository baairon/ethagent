import fs from 'node:fs/promises'
import { type EthagentIdentity } from '../../../storage/config.js'
import { continuityVaultRef, defaultContinuityFiles, type PrivateContinuityFile } from '../storage.js'

export function privateContinuityPath(identity: EthagentIdentity, file: PrivateContinuityFile): string {
  const ref = continuityVaultRef(identity)
  return file === 'SOUL.md' ? ref.soulPath : ref.memoryPath
}

export async function readPrivateContinuityFile(
  identity: EthagentIdentity,
  file: PrivateContinuityFile,
  fullPath: string,
): Promise<{ content: string; existedBefore: boolean }> {
  try {
    return { content: await fs.readFile(fullPath, 'utf8'), existedBefore: true }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: defaultContinuityFiles(identity)[file], existedBefore: false }
    }
    throw err
  }
}
