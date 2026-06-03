import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getConfigDir } from '../../storage/config.js'
import { extractManagedExtra } from './managedBlock.js'

function mirrorStatePath(filePath: string): string {
  return path.join(path.dirname(filePath), '.ethagent-mirror.json')
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function readLastExtraHash(filePath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(mirrorStatePath(filePath), 'utf8')) as { extraHash?: unknown }
    return typeof parsed.extraHash === 'string' ? parsed.extraHash : null
  } catch {
    return null
  }
}

/** Record the skill/guidance section ethagent just wrote, so a later harness edit is detectable. */
export async function writeLastExtraHash(filePath: string, block: string): Promise<void> {
  try {
    await fs.writeFile(mirrorStatePath(filePath), `${JSON.stringify({ extraHash: hash(extractManagedExtra(block) ?? '') })}\n`, 'utf8')
  } catch { /* state is best-effort */ }
}

/**
 * Skills are vault-authoritative (like Claude's read-only mirror), so a mirror overwrites
 * a harness's skill section. Before doing so, if the harness changed that section since
 * ethagent last wrote it, back the edit up to ~/.ethagent/skill-edits/ so nothing the
 * agent wrote is lost silently. Returns the backup path if one was made.
 */
export async function preserveHarnessSkillEdits(filePath: string, harness: string): Promise<string | null> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const extra = extractManagedExtra(content)
  if (!extra) return null
  const last = await readLastExtraHash(filePath)
  if (last === null || hash(extra) === last) return null // first write, or unchanged since we wrote it
  try {
    const dir = path.join(getConfigDir(), 'skill-edits')
    await fs.mkdir(dir, { recursive: true })
    const backup = path.join(dir, `${harness}-${Date.now()}.md`)
    await fs.writeFile(backup, `${extra}\n`, 'utf8')
    return backup
  } catch {
    return null
  }
}
