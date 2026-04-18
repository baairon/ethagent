export type Segment =
  | { kind: 'text'; content: string; preview: string }
  | { kind: 'code'; lang: string | null; content: string; preview: string }

const FENCE = /^[ \t]{0,3}```([\w+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]{0,3}```[ \t]*(?:\r?\n|$)/gm

export function parseSegments(markdown: string): Segment[] {
  if (!markdown) return []
  const segments: Segment[] = []
  let lastIndex = 0
  FENCE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index)
    const textSeg = toTextSegment(before)
    if (textSeg) segments.push(textSeg)
    const lang = match[1] && match[1].length > 0 ? match[1] : null
    const body = match[2] ?? ''
    segments.push({
      kind: 'code',
      lang,
      content: body,
      preview: codePreview(lang, body),
    })
    lastIndex = match.index + match[0].length
  }
  const tail = markdown.slice(lastIndex)
  const tailSeg = toTextSegment(tail)
  if (tailSeg) segments.push(tailSeg)
  return segments
}

function toTextSegment(raw: string): Segment | null {
  const cleaned = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!cleaned) return null
  return { kind: 'text', content: cleaned, preview: textPreview(cleaned) }
}

function textPreview(text: string): string {
  const firstLine = text.split('\n').find(line => line.trim().length > 0) ?? text
  const trimmed = firstLine.trim()
  const chars = text.length
  const snippet = trimmed.length > 48 ? trimmed.slice(0, 47) + '…' : trimmed
  return `text · ${chars} chars · ${snippet}`
}

function codePreview(lang: string | null, body: string): string {
  const lineCount = body.length === 0 ? 0 : body.split('\n').length
  const label = lang ?? 'code'
  return `code · ${label} · ${lineCount} line${lineCount === 1 ? '' : 's'}`
}
