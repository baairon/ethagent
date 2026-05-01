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
      'Local GGUF models and metadata',
      'llama.cpp runner assets',
      'External package-installed runtimes',
    ],
    remoteDescriptions: [
      'ERC-8004 tokens and onchain records',
      'IPFS snapshots and public metadata',
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
    'Ethagent Reset',
    '',
    'Deletes:',
    ...formatDeleteSummary(plan.deletePaths.length),
    '',
    'Keeps:',
    ...plan.preservedDescriptions.map(item => `  - ${item}`),
    '',
    'Not Touched:',
    ...plan.remoteDescriptions.map(item => `  - ${item}`),
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

function formatDeleteSummary(count: number): string[] {
  if (count === 0) return ['  - No local ethagent data found']
  return [
    '  - Identity files, sessions, history, credentials',
    `  - ${count} local path${count === 1 ? '' : 's'} under ~/.ethagent`,
  ]
}

function assertInsideConfigDir(configDir: string, target: string): void {
  const relative = path.relative(path.resolve(configDir), path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to reset path outside ethagent config: ${target}`)
  }
}
