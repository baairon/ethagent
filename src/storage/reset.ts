import fs from 'node:fs/promises'
import { getConfigDir } from './config.js'
import { getSecret, rmSecret, setSecret } from './secrets.js'

const ALL_SECRET_ACCOUNTS = ['ethereum:default', 'pinata:jwt'] as const
const PRESERVED_SECRET_ACCOUNTS = ['pinata:jwt'] as const

export type ResetPlan = {
  configDir: string
  secretAccounts: string[]
  preservedAccounts: string[]
}

export type ResetDeps = {
  rm?: (dir: string) => Promise<void>
  removeSecret?: (account: string) => Promise<void>
  readSecret?: (account: string) => Promise<string | null>
  writeSecret?: (account: string, value: string) => Promise<unknown>
}

export function resetPlan(): ResetPlan {
  const preserved = new Set<string>(PRESERVED_SECRET_ACCOUNTS)
  return {
    configDir: getConfigDir(),
    secretAccounts: ALL_SECRET_ACCOUNTS.filter(account => !preserved.has(account)),
    preservedAccounts: [...PRESERVED_SECRET_ACCOUNTS],
  }
}

export async function runReset(deps: ResetDeps = {}): Promise<ResetPlan> {
  const plan = resetPlan()
  const rm = deps.rm ?? (dir => fs.rm(dir, { recursive: true, force: true }))
  const removeSecret = deps.removeSecret ?? rmSecret
  const readSecret = deps.readSecret ?? getSecret
  const writeSecret = deps.writeSecret ?? setSecret

  const preserved: Array<{ account: string; value: string }> = []
  for (const account of plan.preservedAccounts) {
    const value = await readSecret(account).catch(() => null)
    if (value) preserved.push({ account, value })
  }

  await rm(plan.configDir)
  for (const account of plan.secretAccounts) await removeSecret(account)

  for (const { account, value } of preserved) {
    await writeSecret(account, value).catch(() => null)
  }
  return plan
}
