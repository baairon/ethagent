import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir } from './config.js'

const MAX_ENTRIES = 500

export function getHistoryPath(): string {
  return path.join(getConfigDir(), 'history.jsonl')
}

type Entry = { text: string; ts: number }

export async function appendHistory(text: string): Promise<void> {
  const clean = text.trim()
  if (!clean) return
  try {
    await fs.mkdir(getConfigDir(), { recursive: true })
  } catch {
    return
  }
  const line = JSON.stringify({ text: clean, ts: Date.now() } satisfies Entry) + '\n'
  try {
    await fs.appendFile(getHistoryPath(), line, { mode: 0o600 })
  } catch {
    return
  }
}

export async function readHistory(): Promise<string[]> {
  let raw: string
  try {
    raw = await fs.readFile(getHistoryPath(), 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const entries: Entry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as Entry)
    } catch {
      continue
    }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry) continue
    if (seen.has(entry.text)) continue
    seen.add(entry.text)
    out.unshift(entry.text)
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}
