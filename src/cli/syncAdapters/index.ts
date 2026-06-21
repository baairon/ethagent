import type { PublicSkill } from './shared.js'
import { claudeCodeAdapter } from './claude-code.js'
import { codexAdapter } from './codex.js'
import { genericAdapter } from './generic.js'
import { removeManagedBlock } from './managedBlock.js'

export type SyncContext = {
  soul: string
  memory: string
}

export type ManagedRead = {
  soul: string | null
  memory: string | null
  mtimeMs: number
  lastSoulHash?: string
  lastMemoryHash?: string
}

export type AdapterCapabilities = {
  nativeHooks?: boolean
  instructionFile?: boolean
}

export type SyncAdapter = {
  name: string
  description: string
  capabilities?: AdapterCapabilities
  detect: () => Promise<boolean>
  readManaged?: () => Promise<ManagedRead | null>
  readManagedCandidates?: () => Promise<ManagedRead[]>
  managedFilePaths?: () => string[]
  managedFilePathsAsync?: () => Promise<string[]>
  resetManagedFilePaths?: () => Promise<string[]>
  cleanup?: () => Promise<void>
  bootstrap?: () => Promise<string[]>
  instructionFilePath?: () => string
  mirror: (skills: PublicSkill[], context?: SyncContext) => Promise<{ count: number; skipped: number }>
}

export const BUILT_IN_ADAPTERS: SyncAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  genericAdapter,
]

export async function adapterManagedFilePaths(adapter: SyncAdapter): Promise<string[]> {
  const sync = adapter.managedFilePaths?.() ?? []
  const async = adapter.managedFilePathsAsync ? await adapter.managedFilePathsAsync().catch(() => []) : []
  return [...sync, ...async]
}

export async function clearHarnessManagedBlocks(): Promise<string[]> {
  const cleared: string[] = []
  for (const adapter of BUILT_IN_ADAPTERS) {
    const paths = adapter.resetManagedFilePaths
      ? await adapter.resetManagedFilePaths().catch(() => [])
      : await adapterManagedFilePaths(adapter)
    for (const filePath of paths) {
      if (await removeManagedBlock(filePath).catch(() => false)) cleared.push(filePath)
    }
    await adapter.cleanup?.().catch(() => {})
  }
  return cleared
}
