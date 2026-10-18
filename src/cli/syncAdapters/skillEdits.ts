import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getConfigDir } from '../../storage/config.js'
import { atomicWriteText } from '../../storage/atomicWrite.js'
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

export async function writeLastExtraHash(filePath: string, block: string): Promise<void> {
  await atomicWriteText(mirrorStatePath(filePath), `${JSON.stringify({ extraHash: hash(extractManagedExtra(block) ?? '') })}\n`, { mode: 0o644 })
}

export async function preserveHarnessSkillEdits(filePath: string, harness: string): Promise<string | null> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const extra = extractManagedExtra(content)
  if (!extra) return null
  const last = await readLastExtraHash(filePath)
  if (hash(extra) === last) return null
  try {
    const dir = path.join(getConfigDir(), 'skill-edits')
    await fs.mkdir(dir, { recursive: true })
    const backup = path.join(dir, `${harness}-${Date.now()}.md`)
    await fs.writeFile(backup, `${extra}\n`, 'utf8')
    return backup
  } catch (err) {
    throw new Error(`could not preserve edited skill text from ${filePath}: ${(err as Error).message}`)
  }
}
