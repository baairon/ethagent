import fs from 'node:fs/promises'
import { getConfigDir } from './config.js'
import { rmSecret } from './secrets.js'

const RESET_SECRET_ACCOUNTS = ['ethereum:default', 'pinata:jwt'] as const

export type ResetPlan = {
  configDir: string
  secretAccounts: string[]
}

export type ResetDeps = {
  rm?: (dir: string) => Promise<void>
  removeSecret?: (account: string) => Promise<void>
}

export function resetPlan(): ResetPlan {
  return {
    configDir: getConfigDir(),
    secretAccounts: [...RESET_SECRET_ACCOUNTS],
  }
}

export async function runReset(deps: ResetDeps = {}): Promise<ResetPlan> {
  const plan = resetPlan()
  const rm = deps.rm ?? (dir => fs.rm(dir, { recursive: true, force: true }))
  const removeSecret = deps.removeSecret ?? rmSecret
  await rm(plan.configDir)
  for (const account of plan.secretAccounts) await removeSecret(account)
  return plan
}
