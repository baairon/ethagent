import { loadConfig } from '../storage/config.js'
import { hookFilePath, readHookPayload } from './hookIo.js'
import { writePreToolDeny } from './guardOutput.js'
import { decideMemoryGuard } from './memoryGuard.js'
import { decideSkillGuard } from './skillGuard.js'

export async function runPreToolGuard(): Promise<number> {
  try {
    const config = await loadConfig()
    const filePath = hookFilePath(await readHookPayload())
    const opts = { identityPresent: !!config?.identity }
    const memory = decideMemoryGuard(filePath, opts)
    const decision = memory.deny ? memory : decideSkillGuard(filePath, opts)
    if (decision.deny && decision.reason) writePreToolDeny(decision.reason)
  } catch { /* on any guard failure, stay silent and allow the tool call */ }
  return 0
}
