import os from 'node:os'
import path from 'node:path'
import type { EthagentConfig } from '../storage/config.js'
import { ensureLlamaCppRunnerReady } from '../models/llamacppPreflight.js'

export function compressHome(cwd: string): string {
  const home = os.homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + path.sep)) return '~' + cwd.slice(home.length).replace(/\\/g, '/')
  return cwd.replace(/\\/g, '/')
}

export async function ensureLocalProviderReady(config: EthagentConfig): Promise<{ ok: true } | { ok: false; message: string }> {
  if (config.provider === 'llamacpp') return ensureLlamaCppRunnerReady(config)
  return { ok: true }
}
