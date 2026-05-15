import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { ensureConfigDir, getConfigDir } from '../storage/config.js'

export type LocalRunnerConfig = {
  llamaServerPath?: string
}

export function getLocalRunnerConfigPath(): string {
  return path.join(getConfigDir(), 'local-runner.json')
}

export async function loadLocalRunnerConfig(): Promise<LocalRunnerConfig> {
  try {
    const raw = await fs.readFile(getLocalRunnerConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const value = (parsed as { llamaServerPath?: unknown }).llamaServerPath
    return typeof value === 'string' && value.trim() ? { llamaServerPath: value.trim() } : {}
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return {}
  }
}

export async function saveLocalRunnerConfig(config: LocalRunnerConfig): Promise<void> {
  await ensureConfigDir()
  await atomicWriteText(getLocalRunnerConfigPath(), JSON.stringify(config, null, 2) + '\n')
}

export async function setLlamaCppServerPath(serverPath: string): Promise<void> {
  await saveLocalRunnerConfig({ llamaServerPath: serverPath.trim() })
}
