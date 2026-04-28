import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfigDir } from './config.js'
import type { Message } from '../providers/contracts.js'
import { getCwd } from '../runtime/cwd.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import { atomicWriteText } from './atomicWrite.js'
import {
  isUserCorrectionOfToolState,
  looksLikeToolStateClaim,
} from '../runtime/toolClaimGuards.js'

export type SessionMessage =
  | { version?: 2; role: 'user'; content: string; createdAt: string; turnId?: string }
  | { version?: 2; role: 'assistant'; content: string; createdAt: string; model?: string; usage?: { in?: number; out?: number }; turnId?: string }
  | { version?: 2; role: 'system'; content: string; createdAt: string; turnId?: string }
  | { version: 2; role: 'tool_use'; toolUseId: string; name: string; input: Record<string, unknown>; createdAt: string; turnId?: string }
  | { version: 2; role: 'tool_result'; toolUseId: string; name: string; content: string; isError?: boolean; createdAt: string; turnId?: string }

export type SessionMetadata = {
  id: string
  startedAt: string
  updatedAt: string
  projectRoot: string
  workspaceRoot: string
  lastCwd: string
  provider?: string
  model?: string
  mode?: SessionMode
  firstUserMessage: string
  turnCount: number
  archivedAt?: string
  compactedToSessionId?: string
  compactedFromSessionId?: string
}

export type SessionSummary = SessionMetadata & {
  path: string
  mtimeMs: number
  projectLabel: string
  directoryLabel: string
}

export type SessionWriteContext = {
  cwd: string
  provider?: string
  model?: string
  mode?: SessionMode
}

const SessionMetadataSchemaVersion = 1

export function getSessionsDir(): string {
  return path.join(getConfigDir(), 'sessions')
}

export function newSessionId(): string {
  return randomUUID()
}

function sessionPath(id: string): string {
  return path.join(getSessionsDir(), `${id}.jsonl`)
}

function sessionMetaPath(id: string): string {
  return path.join(getSessionsDir(), `${id}.meta.json`)
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(getSessionsDir(), { recursive: true })
}

export async function appendSessionMessage(
  id: string,
  message: SessionMessage,
  context?: SessionWriteContext,
): Promise<void> {
  await ensureSessionsDir()
  await fs.appendFile(sessionPath(id), JSON.stringify(message) + '\n', { mode: 0o600 })
  if (context) {
    await updateSessionMetadata(id, message, context)
  }
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
      out.push(normalizeSessionMessage(JSON.parse(trimmed) as SessionMessage))
    } catch {
      continue
    }
  }
  return out
}

export async function loadSessionMetadata(id: string): Promise<SessionMetadata | null> {
  try {
    const raw = await fs.readFile(sessionMetaPath(id), 'utf8')
    return normalizeMetadata(JSON.parse(raw) as Partial<SessionMetadata> & { version?: number }, id)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function ensureSessionMetadata(id: string, context: SessionWriteContext): Promise<SessionMetadata> {
  const existing = await loadSessionMetadata(id)
  if (existing) return existing
  const now = new Date().toISOString()
  const metadata: SessionMetadata = {
    id,
    startedAt: now,
    updatedAt: now,
    projectRoot: await detectProjectRoot(context.cwd),
    workspaceRoot: context.cwd,
    lastCwd: context.cwd,
    provider: context.provider,
    model: context.model,
    mode: context.mode,
    firstUserMessage: '',
    turnCount: 0,
  }
  await writeSessionMetadata(metadata)
  return metadata
}

export async function updateSessionActivity(
  id: string,
  context: SessionWriteContext,
  changes: Partial<Pick<SessionMetadata, 'workspaceRoot' | 'lastCwd' | 'provider' | 'model' | 'mode' | 'compactedFromSessionId'>>,
): Promise<SessionMetadata> {
  const base = await ensureSessionMetadata(id, context)
  const next: SessionMetadata = {
    ...base,
    updatedAt: new Date().toISOString(),
    projectRoot: changes.workspaceRoot ? await detectProjectRoot(changes.workspaceRoot) : base.projectRoot,
    workspaceRoot: changes.workspaceRoot ?? base.workspaceRoot,
    lastCwd: changes.lastCwd ?? context.cwd,
    provider: changes.provider ?? context.provider ?? base.provider,
    model: changes.model ?? context.model ?? base.model,
    mode: changes.mode ?? context.mode ?? base.mode,
    compactedFromSessionId: changes.compactedFromSessionId ?? base.compactedFromSessionId,
  }
  await writeSessionMetadata(next)
  return next
}

export async function archiveSession(
  id: string,
  context: SessionWriteContext,
  details: { compactedToSessionId?: string } = {},
): Promise<SessionMetadata> {
  const base = await ensureSessionMetadata(id, context)
  const next: SessionMetadata = {
    ...base,
    updatedAt: new Date().toISOString(),
    archivedAt: base.archivedAt ?? new Date().toISOString(),
    compactedToSessionId: details.compactedToSessionId ?? base.compactedToSessionId,
  }
  await writeSessionMetadata(next)
  return next
}

export async function listSessions(limit = 50): Promise<SessionSummary[]> {
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

  const sessionIds = files
    .filter(file => file.endsWith('.jsonl'))
    .map(file => file.slice(0, -'.jsonl'.length))

  const summaries = await Promise.all(sessionIds.map(async id => summarizeSession(id)))
  return summaries
    .filter((value): value is SessionSummary => value !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
}

export type ProviderMessageProjectionOptions = {
  compactToolHistory?: boolean
  preserveTurnId?: string
}

export const TOOL_CORRECTION_CONTEXT_MESSAGE =
  'The latest user message corrects a prior assistant claim about tool or filesystem state. Treat user correction and tool_result messages as authoritative. Ignore any recent assistant claim about files, directories, cwd, or tool execution unless it is backed by a tool_result, and retry with the appropriate tool.'

export function sessionMessagesToProviderMessages(
  messages: SessionMessage[],
  options: ProviderMessageProjectionOptions = {},
): Message[] {
  const out: Message[] = []
  const pendingToolUses = new Map<string, { name: string; input: Record<string, unknown> }>()
  const invalidatedAssistantMessages = invalidatedAssistantClaimIndexes(messages)

  for (const [index, message] of messages.entries()) {
    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      if (message.role === 'assistant' && invalidatedAssistantMessages.has(index)) continue
      out.push({ role: message.role, content: message.content })
      continue
    }
    if (message.role === 'tool_use') {
      if (shouldCompactToolMessage(message, options)) continue
      pendingToolUses.set(message.toolUseId, { name: message.name, input: message.input })
      continue
    }
    if (shouldCompactToolMessage(message, options)) {
      pendingToolUses.delete(message.toolUseId)
      continue
    }
    const pendingToolUse = pendingToolUses.get(message.toolUseId)
    if (!pendingToolUse) continue
    out.push({
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: message.toolUseId,
        name: pendingToolUse.name,
        input: pendingToolUse.input,
      }],
    })
    out.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        toolUseId: message.toolUseId,
        content: message.content,
        isError: message.isError,
      }],
    })
    pendingToolUses.delete(message.toolUseId)
  }

  return out
}

export function latestUserMessageCorrectsToolState(messages: SessionMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (message.role === 'system') continue
    return message.role === 'user' && isUserCorrectionOfToolState(message.content)
  }
  return false
}

function invalidatedAssistantClaimIndexes(messages: SessionMessage[]): Set<number> {
  const invalidated = new Set<number>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message?.role !== 'user' || !isUserCorrectionOfToolState(message.content)) continue

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const prior = messages[cursor]
      if (!prior) continue
      if (prior.role === 'user') break
      if (prior.role !== 'assistant') continue
      if (!looksLikeToolStateClaim(prior.content)) continue
      if (hasToolEvidenceBetween(messages, cursor, index)) continue
      invalidated.add(cursor)
    }
  }

  return invalidated
}

function hasToolEvidenceBetween(messages: SessionMessage[], start: number, end: number): boolean {
  for (let index = start + 1; index < end; index += 1) {
    const message = messages[index]
    if (message?.role === 'tool_result') return true
  }
  return false
}

function shouldCompactToolMessage(
  message: Extract<SessionMessage, { role: 'tool_use' | 'tool_result' }>,
  options: ProviderMessageProjectionOptions,
): boolean {
  if (!options.compactToolHistory) return false
  return !message.turnId || message.turnId !== options.preserveTurnId
}

function normalizeSessionMessage(message: SessionMessage): SessionMessage {
  if ('version' in message && message.version === 2) return message
  return message
}

async function summarizeSession(id: string): Promise<SessionSummary | null> {
  const full = sessionPath(id)
  let stat
  try {
    stat = await fs.stat(full)
  } catch {
    return null
  }

  const metadata = await loadSessionMetadata(id)
  if (metadata) {
    return toSummary(metadata, full, stat.mtimeMs)
  }

  const messages = await loadSession(id)
  if (messages.length === 0) return null
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return null

  const inferredCwd = getCwd()
  const projectRoot = await detectProjectRoot(inferredCwd)
  const fallback: SessionMetadata = {
    id,
    startedAt: firstUser.createdAt,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    projectRoot,
    workspaceRoot: inferredCwd,
    lastCwd: inferredCwd,
    firstUserMessage: firstUser.content.slice(0, 120),
    turnCount: messages.filter(m => m.role === 'user').length,
  }
  return toSummary(fallback, full, stat.mtimeMs)
}

async function updateSessionMetadata(
  id: string,
  message: SessionMessage,
  context: SessionWriteContext,
): Promise<void> {
  const current = await ensureSessionMetadata(id, context)
  const next: SessionMetadata = {
    ...current,
    updatedAt: message.createdAt,
    projectRoot: await detectProjectRoot(context.cwd),
    workspaceRoot: current.workspaceRoot || context.cwd,
    lastCwd: context.cwd,
    provider: context.provider ?? current.provider,
    model: context.model ?? current.model,
    mode: context.mode ?? current.mode,
    firstUserMessage: current.firstUserMessage || (message.role === 'user' ? message.content.slice(0, 120) : ''),
    turnCount: current.turnCount + (message.role === 'user' ? 1 : 0),
  }
  await writeSessionMetadata(next)
}

async function writeSessionMetadata(metadata: SessionMetadata): Promise<void> {
  await ensureSessionsDir()
  const file = sessionMetaPath(metadata.id)
  const payload = {
    version: SessionMetadataSchemaVersion,
    ...metadata,
  }
  await atomicWriteText(file, JSON.stringify(payload, null, 2) + '\n')
}

function normalizeMetadata(
  raw: Partial<SessionMetadata> & { version?: number },
  id: string,
): SessionMetadata {
  const cwd = raw.lastCwd || raw.workspaceRoot || getCwd()
  const now = new Date().toISOString()
  return {
    id,
    startedAt: raw.startedAt || now,
    updatedAt: raw.updatedAt || raw.startedAt || now,
    projectRoot: raw.projectRoot || cwd,
    workspaceRoot: raw.workspaceRoot || cwd,
    lastCwd: raw.lastCwd || raw.workspaceRoot || cwd,
    provider: raw.provider,
    model: raw.model,
    mode: raw.mode,
    firstUserMessage: raw.firstUserMessage || '',
    turnCount: raw.turnCount ?? 0,
    archivedAt: raw.archivedAt,
    compactedToSessionId: raw.compactedToSessionId,
    compactedFromSessionId: raw.compactedFromSessionId,
  }
}

function toSummary(metadata: SessionMetadata, fullPath: string, mtimeMs: number): SessionSummary {
  const projectLabel = path.basename(metadata.projectRoot) || metadata.projectRoot
  const directoryLabel = formatDirectoryLabel(metadata.projectRoot, metadata.workspaceRoot, metadata.lastCwd)
  return {
    ...metadata,
    path: fullPath,
    mtimeMs,
    projectLabel,
    directoryLabel,
  }
}

function formatDirectoryLabel(projectRoot: string, workspaceRoot: string, lastCwd: string): string {
  const workspaceRel = path.relative(projectRoot, workspaceRoot)
  const cwdRel = path.relative(workspaceRoot, lastCwd)
  const workspaceLabel = workspaceRel && !workspaceRel.startsWith('..') ? workspaceRel : path.basename(workspaceRoot)
  if (!cwdRel || cwdRel === '') return workspaceLabel || '.'
  if (cwdRel.startsWith('..')) return workspaceLabel || path.basename(lastCwd)
  return workspaceLabel === '.'
    ? `./${cwdRel}`
    : `${workspaceLabel}/${cwdRel}`.replaceAll('\\', '/')
}

async function detectProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start)
  while (true) {
    if (await exists(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(start)
    current = parent
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
