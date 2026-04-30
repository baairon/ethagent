import { systemMessage } from '../utils/messages.js'
import { buildSystemPrompt } from '../runtime/systemPrompt.js'
import type { Message } from '../providers/contracts.js'
import { isLocalProvider } from '../providers/registry.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import type { EthagentConfig } from '../storage/config.js'
import {
  latestUserMessageCorrectsToolState,
  sessionMessagesToProviderMessages,
  TOOL_CORRECTION_CONTEXT_MESSAGE,
  type SessionMessage,
} from '../storage/sessions.js'
import type { MessageRow } from './MessageList.js'
import { hidesSuccessfulToolResultContent } from './toolResultDisplay.js'

export type TurnCheckpoint = {
  sessionId: string
  turnId: string
  messageRole: 'user'
  promptSnippet: string
  checkpointLabel: string
}

export function buildBaseMessages(
  sessionMessages: SessionMessage[],
  config: EthagentConfig,
  hasTools: boolean,
  cwd: string,
  mode: SessionMode = 'chat',
  options: { preserveTurnId?: string; compactToolHistory?: boolean } = {},
): Message[] {
  const compactToolHistory = options.compactToolHistory ?? isLocalProvider(config.provider)
  const correctionContext = latestUserMessageCorrectsToolState(sessionMessages)
    ? [systemMessage(TOOL_CORRECTION_CONTEXT_MESSAGE)]
    : []
  return [
    systemMessage(buildSystemPrompt({
      cwd,
      model: config.model,
      provider: config.provider,
      hasTools,
      hasIdentity: Boolean(config.identity),
      mode,
    })),
    ...correctionContext,
    ...sessionMessagesToProviderMessages(sessionMessages, {
      compactToolHistory,
      preserveTurnId: options.preserveTurnId,
    }),
  ]
}

export function sessionMessagesToRows(messages: SessionMessage[], nextRowId: () => string): MessageRow[] {
  const restored: MessageRow[] = []
  for (const msg of messages) {
    if (msg.role === 'user') restored.push({ role: 'user', id: nextRowId(), content: msg.content })
    else if (msg.role === 'assistant') restored.push({ role: 'assistant', id: nextRowId(), content: msg.content })
    else if (msg.role === 'tool_use') {
      restored.push({
        role: 'tool_use',
        id: nextRowId(),
        name: msg.name,
        summary: msg.name,
        input: summarizeToolInput(msg.input),
      })
    } else if (msg.role === 'tool_result') {
      restored.push({
        role: 'tool_result',
        id: nextRowId(),
        name: msg.name,
        summary: msg.isError ? `${msg.name} failed` : `${msg.name} completed`,
        content: toolResultContentForRow(msg.name, msg.content, msg.isError),
        isError: msg.isError,
      })
    }
  }
  return restored
}

export function summarizeToolInput(input: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(input)
    if (text.length <= 160) return text
    return `${text.slice(0, 157)}...`
  } catch {
    return '[unserializable input]'
  }
}

export function truncateForRow(text: string, max = 1200): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}

export function toolResultContentForRow(name: string, content: string, isError?: boolean): string {
  return hidesSuccessfulToolResultContent(name, isError) ? '' : truncateForRow(content)
}

export function splitStreamingContent(text: string): { committed: string; liveTail: string } {
  if (!text) return { committed: '', liveTail: '' }
  const boundary = findStableBoundary(text)
  if (boundary <= 0 || boundary >= text.length) {
    return { committed: boundary >= text.length ? text : '', liveTail: boundary >= text.length ? '' : text }
  }
  return { committed: text.slice(0, boundary), liveTail: text.slice(boundary) }
}

export function findStableBoundary(text: string): number {
  let lastStructural = 0
  let lastSentence = 0
  let inFence = false
  let offset = 0
  const lines = text.match(/[^\n]*\n?|$/g)?.filter(Boolean) ?? []

  for (const lineWithEnding of lines) {
    const line = lineWithEnding.endsWith('\n') ? lineWithEnding.slice(0, -1) : lineWithEnding
    const trimmed = line.trim()
    const nextOffset = offset + lineWithEnding.length

    if (/^```/.test(trimmed)) {
      inFence = !inFence
      if (!inFence) lastStructural = nextOffset
      offset = nextOffset
      continue
    }

    if (!inFence) {
      if (!trimmed) {
        lastStructural = nextOffset
      } else if (/^(#{1,3}\s|>\s?|[-*+]\s|\d+\.\s)/.test(trimmed)) {
        lastStructural = nextOffset
      }

      let match: RegExpExecArray | null
      const sentencePattern = /[.!?]["')\]]?(?=\s|$)/g
      while ((match = sentencePattern.exec(line)) !== null) {
        lastSentence = offset + match.index + match[0].length
      }
    }

    offset = nextOffset
  }

  if (inFence) return lastStructural
  if (lastStructural > 0) return lastStructural
  if (text.length > 220 && lastSentence > 0) return lastSentence
  if (text.length > 320) {
    const fallbackSpace = text.lastIndexOf(' ', Math.max(160, text.length - 80))
    if (fallbackSpace > 80) return fallbackSpace + 1
  }
  return 0
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0B'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(2)}GB`
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(0)}MB`
  const kb = bytes / 1024
  return `${kb.toFixed(0)}KB`
}

export function createTurnCheckpoint(sessionId: string, userText: string): TurnCheckpoint {
  const promptSnippet = summarizePrompt(userText)
  return {
    sessionId,
    turnId: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    messageRole: 'user',
    promptSnippet,
    checkpointLabel: promptSnippet || 'Untitled checkpoint',
  }
}

export function summarizePrompt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 93)}...`
}

export function buildDeleteCommand(targetPath: string): string {
  const escaped = targetPath.replace(/"/g, '""')
  if (process.platform === 'win32') {
    return `del /f /q "${escaped}"`
  }
  return `rm -f -- "${targetPath.replace(/"/g, '\\"')}"`
}
