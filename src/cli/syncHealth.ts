import fs from 'node:fs/promises'
import path from 'node:path'
import type { EthagentIdentity } from '../storage/config.js'
import { getConfigDir } from '../storage/config.js'
import { atomicWriteText } from '../storage/atomicWrite.js'

export type SyncIssue = {
  kind: 'detect' | 'reconcile' | 'skills' | 'adapter' | 'skipped' | 'mirror' | 'manifest' | 'remove' | 'source'
  location: string
  skill?: string
  detail: string
}

export type SyncHealth = {
  version: 1
  identityKey: string
  state: 'ok' | 'failed' | 'no-targets'
  attemptedAt: string
  lastSuccessAt: string | null
  issues: SyncIssue[]
}

export function syncHealthPath(): string {
  return path.join(getConfigDir(), 'sync-health.json')
}

function identityKey(identity: EthagentIdentity): string {
  return [identity.chainId ?? '', identity.identityRegistryAddress?.toLowerCase() ?? '', identity.agentId ?? '', identity.address.toLowerCase()].join(':')
}

export async function readSyncHealth(identity: EthagentIdentity): Promise<SyncHealth | null> {
  let parsed: unknown
  try { parsed = JSON.parse(await fs.readFile(syncHealthPath(), 'utf8')) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const health = parsed as Partial<SyncHealth>
  if (health.version !== 1 || health.identityKey !== identityKey(identity)) return null
  if (!['ok', 'failed', 'no-targets'].includes(String(health.state))) return null
  if (typeof health.attemptedAt !== 'string' || !Array.isArray(health.issues)) return null
  if (health.lastSuccessAt !== null && typeof health.lastSuccessAt !== 'string') return null
  if (!health.issues.every(issue => issue && typeof issue === 'object'
    && typeof issue.kind === 'string' && typeof issue.location === 'string'
    && typeof issue.detail === 'string' && (issue.skill === undefined || typeof issue.skill === 'string'))) return null
  return health as SyncHealth
}

export async function writeSyncHealth(
  identity: EthagentIdentity,
  state: SyncHealth['state'],
  attemptedAt: string,
  issues: SyncIssue[],
): Promise<SyncHealth> {
  const previous = await readSyncHealth(identity)
  const next: SyncHealth = {
    version: 1,
    identityKey: identityKey(identity),
    state,
    attemptedAt,
    lastSuccessAt: state === 'ok' ? attemptedAt : previous?.lastSuccessAt ?? null,
    issues,
  }
  await fs.mkdir(getConfigDir(), { recursive: true })
  await atomicWriteText(syncHealthPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return next
}

export function formatSyncIssue(issue: SyncIssue): string {
  const at = issue.skill ? `${issue.location}/${issue.skill}` : issue.location
  return `${at}: ${issue.detail}`
}
