import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir } from './config.js'
import type { SessionMessage } from './sessions.js'

export function getExportsDir(): string {
  return path.join(getConfigDir(), 'exports')
}

export async function exportSessionMarkdown(
  id: string,
  messages: SessionMessage[],
  meta: { model: string; provider: string },
): Promise<string> {
  await fs.mkdir(getExportsDir(), { recursive: true })
  const file = path.join(getExportsDir(), `${id}.md`)

  const userTurns = messages.filter(m => m.role === 'user').length
  const lines: string[] = []
  lines.push('---')
  lines.push(`session: ${id}`)
  lines.push(`provider: ${meta.provider}`)
  lines.push(`model: ${meta.model}`)
  lines.push(`turns: ${userTurns}`)
  lines.push(`exportedAt: ${new Date().toISOString()}`)
  lines.push('---')
  lines.push('')
  for (const m of messages) {
    if (m.role === 'system') continue
    const header =
      m.role === 'user'
        ? '## user'
        : m.role === 'assistant'
          ? '## assistant'
          : m.role === 'tool_use'
            ? `## tool use · ${m.name}`
            : `## tool result · ${m.name}`
    lines.push(`${header}  <sub>${m.createdAt}</sub>`)
    lines.push('')
    if (m.role === 'tool_use') {
      lines.push(JSON.stringify(m.input, null, 2))
    } else {
      lines.push(m.content)
    }
    lines.push('')
  }
  await fs.writeFile(file, lines.join('\n'), { mode: 0o600 })
  return file
}
