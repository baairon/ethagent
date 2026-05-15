import fs from 'node:fs/promises'
import path from 'node:path'
import type { Message } from '../providers/contracts.js'

export async function buildFileMentionContextMessages(
  userText: string,
  cwd: string,
): Promise<Message[]> {
  const mentions = extractFileMentions(userText)
  if (mentions.length === 0) return []

  const lines: string[] = []
  for (const mention of mentions) {
    const resolved = path.resolve(cwd, mention)
    const rel = path.relative(cwd, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      lines.push(
        `@${mention} -> outside current workspace; do not use unless the user changes directory or names an allowed path.`,
      )
      continue
    }
    try {
      const stats = await fs.stat(resolved)
      lines.push(`@${mention} -> ${mention} (${stats.isDirectory() ? 'directory' : 'file'})`)
    } catch {
      lines.push(`@${mention} -> unresolved`)
    }
  }

  return [
    {
      role: 'user',
      content: [
        'Resolved file mentions for this request:',
        ...lines,
        'Treat these mentions as authoritative filenames from the user request. Read referenced context files when needed, and edit only the file requested by the user or the target file you have inspected.',
      ].join('\n'),
    },
  ]
}

function extractFileMentions(text: string): string[] {
  const mentions = new Set<string>()
  for (const match of text.matchAll(/@([^\s]+)/g)) {
    const raw = match[1]?.replace(/[),.;:!?]+$/g, '')
    if (!raw || raw.length === 0) continue
    mentions.add(raw.replace(/\\/g, '/'))
  }
  return [...mentions]
}
