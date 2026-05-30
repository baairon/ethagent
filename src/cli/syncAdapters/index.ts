import fs from 'node:fs/promises'
import type { PublicSkill } from './shared.js'
import { claudeCodeAdapter } from './claude-code.js'
import { codexAdapter } from './codex.js'
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

export type SyncAdapter = {
  name: string
  description: string
  detect: () => Promise<boolean>
  readManaged?: () => Promise<ManagedRead | null>
  managedFilePaths?: () => string[]
  mirrorPaths?: () => string[]
  cleanup?: () => Promise<void>
  mirror: (skills: PublicSkill[], context?: SyncContext) => Promise<{ count: number; skipped: number }>
}

export const BUILT_IN_ADAPTERS: SyncAdapter[] = [claudeCodeAdapter, codexAdapter]

export async function clearHarnessManagedBlocks(): Promise<string[]> {
  const cleared: string[] = []
  for (const adapter of BUILT_IN_ADAPTERS) {
    const paths = [...(adapter.managedFilePaths?.() ?? []), ...(adapter.mirrorPaths?.() ?? [])]
    for (const filePath of paths) {
      if (await removeManagedBlock(filePath).catch(() => false)) cleared.push(filePath)
    }
    await adapter.cleanup?.().catch(() => {})
  }
  return cleared
}
