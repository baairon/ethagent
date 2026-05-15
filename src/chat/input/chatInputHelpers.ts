import fs from 'node:fs/promises'
import path from 'node:path'
import {
  countPastedTextLineBreaks,
  LARGE_PASTE_THRESHOLD,
  normalizePastedText,
} from './chatPaste.js'
import type { FileMentionToken } from './chatInputState.js'

const MAX_INLINE_PASTE_LINES = 2

export function isSoftBreak(key: { return: boolean; meta?: boolean; shift?: boolean }): boolean {
  return key.return && Boolean(key.meta || key.shift)
}

export function isFallbackPasteInput(input: string): boolean {
  if (!input) return false
  return input.length > LARGE_PASTE_THRESHOLD
    || countPastedTextLineBreaks(normalizePastedText(input)) > MAX_INLINE_PASTE_LINES
}

export function summarizeQueuedMessage(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 69)}...`
}

export type FileMentionSuggestion = {
  path: string
  hint: string
}

export async function listFileMentionSuggestions(
  cwd: string,
  mention: FileMentionToken,
): Promise<FileMentionSuggestion[]> {
  const query = mention.query.replace(/\\/g, '/')
  const lastSlash = query.lastIndexOf('/')
  const queryDir = lastSlash >= 0 ? query.slice(0, lastSlash + 1) : ''
  const basenameQuery = lastSlash >= 0 ? query.slice(lastSlash + 1).toLowerCase() : query.toLowerCase()
  const baseDir = path.resolve(cwd, queryDir || '.')

  let entries: Array<{ name: string; isFile: () => boolean }>
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().startsWith(basenameQuery))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 32)
    .map(entry => {
      const relative = (queryDir + entry.name).replace(/\\/g, '/')
      return {
        path: relative,
        hint: path.extname(entry.name).slice(1) || 'file',
      }
    })
}
