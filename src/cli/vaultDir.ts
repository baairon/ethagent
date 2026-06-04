import { loadConfig } from '../storage/config.js'
import { continuityVaultRef } from '../identity/continuity/storage.js'

/**
 * Prints this agent's continuity vault directory to stdout. Non-interactive and
 * side-effect-free so an agent/script can discover where skills, soul, and memory
 * physically live (the `skills/` subdir is the one place new skills belong).
 */
export async function runVaultDir(): Promise<number> {
  const config = await loadConfig().catch(() => null)
  if (!config?.identity) {
    process.stderr.write('ethagent: no identity yet; run `npx ethagent` to create one (the vault exists once an identity is set)\n')
    return 1
  }
  process.stdout.write(continuityVaultRef(config.identity).dir + '\n')
  return 0
}
