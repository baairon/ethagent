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
  /** Adapter can self-install real hooks for its harness (e.g. Claude Code settings.json). */
  nativeHooks?: boolean
  /** Adapter injects guidance into a per-session instructions file the harness reads. */
  instructionFile?: boolean
}

export type SyncAdapter = {
  name: string
  description: string
  capabilities?: AdapterCapabilities
  detect: () => Promise<boolean>
  readManaged?: () => Promise<ManagedRead | null>
  /**
   * Every managed file this adapter could pull edits from, as separate reads. Adapters that
   * manage more than one file (the generic adapter's N targets) implement this so reconcile
   * considers each target's newest edit instead of collapsing them to one. Defaults to the
   * single `readManaged()` result.
   */
  readManagedCandidates?: () => Promise<ManagedRead[]>
  /** Synchronously-known managed files (watched by the daemon, matched by the edit guard). */
  managedFilePaths?: () => string[]
  /** Managed files that can only be resolved asynchronously (e.g. the generic target list). */
  managedFilePathsAsync?: () => Promise<string[]>
  resetManagedFilePaths?: () => Promise<string[]>
  cleanup?: () => Promise<void>
  /** Wire this harness's automation (native hooks and/or instruction-file injection). Returns human-readable actions taken. */
  bootstrap?: () => Promise<string[]>
  /** Path of the instructions file this harness reads each session, if any. */
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
