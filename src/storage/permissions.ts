import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ensureConfigDir, getConfigDir } from './config.js'
import { SessionPermissionRuleSchema, type SessionPermissionRule } from '../tools/contracts.js'
import { atomicWriteText } from './atomicWrite.js'

const StoredPermissionRuleSchema = z.object({
  workspaceRoot: z.string().min(1),
  rule: SessionPermissionRuleSchema,
})

type StoredPermissionRule = z.infer<typeof StoredPermissionRuleSchema>

function getPermissionsPath(): string {
  return path.join(getConfigDir(), 'permissions.json')
}

export async function loadPermissionRules(workspaceRoot: string): Promise<SessionPermissionRule[]> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const allRules = await loadAllPermissionRules()
  return allRules
    .filter(entry => path.resolve(entry.workspaceRoot) === normalizedWorkspaceRoot)
    .map(entry => entry.rule)
}

export async function deletePermissionRule(workspaceRoot: string, rule: SessionPermissionRule): Promise<void> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const allRules = await loadAllPermissionRules()
  const next = allRules.filter(entry =>
    !(path.resolve(entry.workspaceRoot) === normalizedWorkspaceRoot && JSON.stringify(entry.rule) === JSON.stringify(rule)),
  )
  await writeAllPermissionRules(next)
}

export async function clearPermissionRules(workspaceRoot: string): Promise<void> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const allRules = await loadAllPermissionRules()
  const next = allRules.filter(entry => path.resolve(entry.workspaceRoot) !== normalizedWorkspaceRoot)
  await writeAllPermissionRules(next)
}

export async function savePermissionRule(workspaceRoot: string, rule: SessionPermissionRule): Promise<void> {
  const allRules = await loadAllPermissionRules()
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const nextEntry: StoredPermissionRule = { workspaceRoot: normalizedWorkspaceRoot, rule }
  const deduped = [...allRules.filter(entry => !sameStoredRule(entry, nextEntry)), nextEntry]
  await writeAllPermissionRules(deduped)
}

async function loadAllPermissionRules(): Promise<StoredPermissionRule[]> {
  let raw: string
  try {
    raw = await fs.readFile(getPermissionsPath(), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  try {
    const parsed = JSON.parse(raw)
    return z.array(StoredPermissionRuleSchema).parse(parsed)
  } catch {
    return []
  }
}

async function writeAllPermissionRules(rules: StoredPermissionRule[]): Promise<void> {
  await ensureConfigDir()
  const file = getPermissionsPath()
  await atomicWriteText(file, JSON.stringify(rules, null, 2) + '\n')
}

function sameStoredRule(left: StoredPermissionRule, right: StoredPermissionRule): boolean {
  return left.workspaceRoot === right.workspaceRoot && JSON.stringify(left.rule) === JSON.stringify(right.rule)
}
