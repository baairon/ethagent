import { splitFileChangeResult } from '../tools/fileDiff.js'
import type { ContinuityEditReviewState } from './views/ContinuityEditReviewView.js'

export function privateContinuityEditReviewFromToolResult(
  name: string,
  input: Record<string, unknown>,
  result: { ok: boolean; summary: string; content: string },
): ContinuityEditReviewState | null {
  if (name !== 'propose_private_continuity_edit' || !result.ok) return null
  const file = normalizePrivateContinuityFile(input.file)
  if (!file) return null
  const parsed = splitFileChangeResult(result.content)
  const filePath = extractReviewFilePath(parsed.content)
  if (!filePath) return null
  return {
    file,
    filePath,
    summary: result.summary,
    ...(parsed.diff ? { diff: parsed.diff } : {}),
  }
}

function normalizePrivateContinuityFile(value: unknown): ContinuityEditReviewState['file'] | null {
  if (typeof value !== 'string') return null
  if (/^soul\.md$/i.test(value.trim())) return 'SOUL.md'
  if (/^memory\.md$/i.test(value.trim())) return 'MEMORY.md'
  return null
}

function extractReviewFilePath(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const review = line.match(/^(?:[-*]\s+)?review file:\s*(.+)$/i)
    if (review?.[1]?.trim()) return cleanReviewFilePath(review[1])
    const updated = line.match(/^(?:[-*]\s+)?updated local private continuity file\s+(.+)$/i)
    if (updated?.[1]?.trim()) return cleanReviewFilePath(updated[1])
  }
  return null
}

function cleanReviewFilePath(value: string): string {
  return value.trim().replace(/^`+|`+$/g, '').trim()
}
