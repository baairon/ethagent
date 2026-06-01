import { loadConfig } from '../storage/config.js'
import { hookFilePath, readHookPayload } from './hookIo.js'
import { decideMemoryGuard } from './memoryGuard.js'
import { decideSkillGuard } from './skillGuard.js'

/**
 * Combined PreToolUse guard: runs the memory-dir guard and the skills-mirror
 * guard from a single process, so each Edit/Write/MultiEdit spawns one `npx`
 * (one config load, one stdin read) instead of two. The two guards check
 * disjoint directories, so at most one denies.
 */
export async function runPreToolGuard(): Promise<number> {
  try {
    const config = await loadConfig()
    const filePath = hookFilePath(await readHookPayload())
    const opts = { identityPresent: !!config?.identity }
    const memory = decideMemoryGuard(filePath, opts)
    const decision = memory.deny ? memory : decideSkillGuard(filePath, opts)
    if (decision.deny) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: decision.reason,
          },
        }) + '\n',
      )
    }
  } catch {}
  return 0
}
