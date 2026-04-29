import fs from 'node:fs/promises'
import path from 'node:path'
import { PROVIDERS, getConfigDir } from './config.js'
import { rmSecret } from './secrets.js'

const PRESERVED_LOCAL_MODEL_ENTRIES = new Set([
  'local-models.json',
  'local-runner.json',
  'models',
  'runners',
])

const SECRET_ACCOUNTS = [
  'ethereum:default',
  'pinata:jwt',
  ...PROVIDERS,
] as const

export type FactoryResetPlan = {
  configDir: string
  deletePaths: string[]
  preservedPaths: string[]
  preservedDescriptions: string[]
  remoteDescriptions: string[]
}

export type FactoryResetResult = {
  deletedPaths: string[]
  preservedPaths: string[]
  clearedSecretAccounts: string[]
}

export async function createFactoryResetPlan(): Promise<FactoryResetPlan> {
  const configDir = path.resolve(getConfigDir())
  const entries = await readConfigEntries(configDir)
  const deletePaths: string[] = []
  const preservedPaths: string[] = []

  for (const entry of entries) {
    const target = path.join(configDir, entry)
    assertInsideConfigDir(configDir, target)
    if (PRESERVED_LOCAL_MODEL_ENTRIES.has(entry)) preservedPaths.push(target)
    else deletePaths.push(target)
  }

  return {
    configDir,
    deletePaths,
    preservedPaths,
    preservedDescriptions: [
      'Hugging Face GGUF model files under models/',
      'local model registry local-models.json',
      'llama.cpp runner assets under runners/',
      'local runner path config local-runner.json',
      'external Ollama/package-installed models outside ~/.ethagent',
    ],
    remoteDescriptions: [
      'ERC-8004 tokens and onchain records',
      'IPFS-pinned encrypted snapshots and public skills metadata',
    ],
  }
}

export async function runFactoryReset(options: { clearSecrets?: boolean } = {}): Promise<FactoryResetResult> {
  const plan = await createFactoryResetPlan()
  const clearedSecretAccounts: string[] = []
  if (options.clearSecrets ?? true) {
    for (const account of SECRET_ACCOUNTS) {
      try {
        await rmSecret(account)
        clearedSecretAccounts.push(account)
      } catch {
        continue
      }
    }
  }

  const deletedPaths: string[] = []
  for (const target of plan.deletePaths) {
    assertInsideConfigDir(plan.configDir, target)
    await fs.rm(target, { recursive: true, force: true })
    deletedPaths.push(target)
  }

  return {
    deletedPaths,
    preservedPaths: plan.preservedPaths,
    clearedSecretAccounts,
  }
}

export function formatFactoryResetPlan(plan: FactoryResetPlan): string {
  return [
    'ethagent reset',
    '',
    'will delete:',
    ...formatPaths(plan.deletePaths, plan.configDir),
    '',
    'will keep:',
    ...plan.preservedDescriptions.map(item => `  - ${item}`),
    '',
    'not touched:',
    ...plan.remoteDescriptions.map(item => `  - ${item}`),
    '',
    'type confirm to reset this machine.',
  ].join('\n')
}

async function readConfigEntries(configDir: string): Promise<string[]> {
  try {
    return await fs.readdir(configDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

function formatPaths(paths: string[], configDir: string): string[] {
  if (paths.length === 0) return ['  - no local ethagent data found']
  return paths
    .map(target => `  - ${path.relative(configDir, target) || path.basename(target)}`)
    .sort()
}

function assertInsideConfigDir(configDir: string, target: string): void {
  const relative = path.relative(path.resolve(configDir), path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to reset path outside ethagent config: ${target}`)
  }
}
