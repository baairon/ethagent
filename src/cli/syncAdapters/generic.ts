import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getConfigDir } from '../../storage/config.js'
import { type PublicSkill } from './shared.js'
import { injectManagedBlock, readManagedContext, renderManagedBlock } from './managedBlock.js'
import { cleanupInstructionFileSkills, mirrorInstructionFile, skillsDirFor } from './instructionFileAdapter.js'
import { buildPortableInstruction } from '../harnessGuidance.js'
import type { ManagedRead, SyncContext, SyncAdapter } from './index.js'

const HARNESSES_FILE = 'harnesses.json'

export function harnessesConfigPath(): string {
  return path.join(getConfigDir(), HARNESSES_FILE)
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

/**
 * The literal "any harness" escape hatch: arbitrary instruction-file paths the user
 * lists in ~/.ethagent/harnesses.json (a JSON array of paths or {path} objects) or in
 * the $ETHAGENT_HARNESS_FILES env var (path-delimiter or comma separated).
 */
function readEnvTargets(): string[] {
  const out: string[] = []
  const env = process.env.ETHAGENT_HARNESS_FILES
  if (env) {
    for (const chunk of env.split(path.delimiter).flatMap(s => s.split(','))) {
      const t = chunk.trim()
      if (t) out.push(path.resolve(expandHome(t)))
    }
  }
  return out
}

async function readConfigFileTargets(): Promise<string[]> {
  const out: string[] = []
  try {
    const parsed = JSON.parse(await fs.readFile(harnessesConfigPath(), 'utf8')) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? (parsed as { targets?: unknown }).targets
        : null
    if (Array.isArray(list)) {
      for (const item of list) {
        const p =
          typeof item === 'string'
            ? item
            : item && typeof item === 'object'
              ? (item as { path?: unknown }).path
              : null
        if (typeof p === 'string' && p.trim()) out.push(path.resolve(expandHome(p.trim())))
      }
    }
  } catch { /* no config file or malformed -> no configured targets */ }
  return out
}

export async function readGenericTargets(): Promise<string[]> {
  return [...new Set([...readEnvTargets(), ...(await readConfigFileTargets())])]
}

/** Register a tool's instructions file in ~/.ethagent/harnesses.json (dedup). Returns the resolved path. */
export async function addGenericTarget(rawPath: string): Promise<string> {
  const resolved = path.resolve(expandHome(rawPath.trim()))
  const configured = await readConfigFileTargets()
  if (!configured.includes(resolved)) {
    await fs.mkdir(getConfigDir(), { recursive: true })
    await fs.writeFile(harnessesConfigPath(), `${JSON.stringify([...configured, resolved], null, 2)}\n`, 'utf8')
  }
  return resolved
}

export const genericAdapter: SyncAdapter = {
  name: 'generic',
  description: 'Mirror soul, memory, and skills into any instruction files listed in ~/.ethagent/harnesses.json or $ETHAGENT_HARNESS_FILES.',
  capabilities: { instructionFile: true },
  async detect(): Promise<boolean> {
    return (await readGenericTargets()).length > 0
  },
  async readManaged(): Promise<ManagedRead | null> {
    let newest: ManagedRead | null = null
    for (const target of await readGenericTargets()) {
      const read = await readManagedContext(target)
      if (read && (!newest || read.mtimeMs > newest.mtimeMs)) newest = read
    }
    return newest
  },
  // One read per target so reconcile honors each target's newest edit; collapsing to the
  // single newest target (as readManaged does) would let an edit in another target be lost.
  async readManagedCandidates(): Promise<ManagedRead[]> {
    const reads: ManagedRead[] = []
    for (const target of await readGenericTargets()) {
      const read = await readManagedContext(target)
      if (read) reads.push(read)
    }
    return reads
  },
  managedFilePaths(): string[] {
    return []
  },
  async managedFilePathsAsync(): Promise<string[]> {
    return readGenericTargets()
  },
  async resetManagedFilePaths(): Promise<string[]> {
    return readGenericTargets()
  },
  async cleanup(): Promise<void> {
    for (const target of await readGenericTargets()) await cleanupInstructionFileSkills(target)
  },
  async bootstrap(): Promise<string[]> {
    const actions: string[] = []
    for (const target of await readGenericTargets()) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      const block = renderManagedBlock(undefined, buildPortableInstruction({ harness: 'generic', skillsLocation: skillsDirFor(target) }))
      await injectManagedBlock(target, block)
      actions.push(`generic: wrote bootstrap instructions to ${target}`)
    }
    return actions
  },
  async mirror(skills: PublicSkill[], context?: SyncContext): Promise<{ count: number; skipped: number }> {
    const targets = await readGenericTargets()
    let skipped = 0
    for (const target of targets) {
      const result = await mirrorInstructionFile(target, 'generic', skills, context)
      skipped += result.skipped
    }
    return { count: targets.length ? skills.length : 0, skipped }
  },
}
