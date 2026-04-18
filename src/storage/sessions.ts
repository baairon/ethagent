import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfigDir } from './config.js'

export type SessionMessage =
  | { role: 'user'; content: string; createdAt: string }
  | { role: 'assistant'; content: string; createdAt: string; model?: string; usage?: { in?: number; out?: number } }
  | { role: 'system'; content: string; createdAt: string }

export type SessionSummary = {
  id: string
  path: string
  mtimeMs: number
  firstUserMessage: string
  turnCount: number
}

export function getSessionsDir(): string {
  return path.join(getConfigDir(), 'sessions')
}

export function newSessionId(): string {
  return randomUUID()
}

function sessionPath(id: string): string {
  return path.join(getSessionsDir(), `${id}.jsonl`)
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(getSessionsDir(), { recursive: true })
}

export async function appendSessionMessage(id: string, message: SessionMessage): Promise<void> {
  await ensureSessionsDir()
  await fs.appendFile(sessionPath(id), JSON.stringify(message) + '\n', { mode: 0o600 })
}

export async function loadSession(id: string): Promise<SessionMessage[]> {
  let raw: string
  try {
    raw = await fs.readFile(sessionPath(id), 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: SessionMessage[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as SessionMessage)
    } catch {
      continue
    }
  }
  return out
}

export async function listSessions(limit = 20): Promise<SessionSummary[]> {
  try {
    await ensureSessionsDir()
  } catch {
    return []
  }
  let files: string[]
  try {
    files = await fs.readdir(getSessionsDir())
  } catch {
    return []
  }
  const summaries: SessionSummary[] = []
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    const id = file.slice(0, -'.jsonl'.length)
    const full = path.join(getSessionsDir(), file)
    let stat
    try {
      stat = await fs.stat(full)
    } catch {
      continue
    }
    const messages = await loadSession(id)
    if (messages.length === 0) continue
    const firstUser = messages.find(m => m.role === 'user')
    if (!firstUser) continue
    const turnCount = messages.filter(m => m.role === 'user').length
    summaries.push({
      id,
      path: full,
      mtimeMs: stat.mtimeMs,
      firstUserMessage: firstUser.content.slice(0, 120),
      turnCount,
    })
  }
  summaries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return summaries.slice(0, limit)
}
