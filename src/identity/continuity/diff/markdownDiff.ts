export type MarkdownItem = { key: string; label?: string; text: string }

export type MarkdownSection = { section: string; items: MarkdownItem[] }

export type SectionChange = {
  section: string
  change: 'added' | 'removed' | 'modified'
  added: string[]
  removed: string[]
  modified: Array<{ label: string; before: string; after: string }>
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET_RE = /^(?:[-*+]|\d+[.)])\s+/
const LABEL_RE = /^(?:[-*+]|\d+[.)])\s+(?:\*\*|__)?([^:*_\n]{1,80}?)(?:\*\*|__)?:\s/

export function parseMarkdownSections(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = []
  const stack: Array<{ level: number; title: string }> = []
  let current: MarkdownSection = { section: '', items: [] }
  sections.push(current)
  let item: string[] | null = null
  let fenced = false
  const flush = (): void => {
    if (!item) return
    const body = item.join('\n').replace(/\s+$/, '')
    item = null
    if (!body.trim()) return
    const label = LABEL_RE.exec(body)?.[1]?.trim()
    const base = label ? `label:${label.toLowerCase()}` : `text:${body.replace(/\s+/g, ' ').trim()}`
    let key = base
    for (let n = 2; current.items.some(existing => existing.key === key); n++) key = `${base}#${n}`
    current.items.push({ key, ...(label ? { label } : {}), text: body })
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : HEADING_RE.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
      stack.push({ level, title: heading[2]! })
      current = { section: stack.map(entry => entry.title).join(' > '), items: [] }
      sections.push(current)
      continue
    }
    if (!fenced && line.trim() === '') {
      flush()
      continue
    }
    if (!fenced && BULLET_RE.test(line)) {
      flush()
      item = [line]
      continue
    }
    if (item) item.push(line)
    else item = [line]
  }
  flush()
  return sections.filter(section => section.section !== '' || section.items.length > 0)
}

export function diffMarkdownSections(aText: string, bText: string): SectionChange[] {
  const a = new Map(parseMarkdownSections(aText).map(section => [section.section, section]))
  const b = parseMarkdownSections(bText)
  const bNames = new Set(b.map(section => section.section))
  const changes: SectionChange[] = []
  for (const section of b) {
    const before = a.get(section.section)
    if (!before) {
      changes.push({ section: section.section, change: 'added', added: section.items.map(item => item.text), removed: [], modified: [] })
      continue
    }
    const beforeByKey = new Map(before.items.map(item => [item.key, item]))
    const afterKeys = new Set(section.items.map(item => item.key))
    const added: string[] = []
    const modified: SectionChange['modified'] = []
    for (const item of section.items) {
      const prior = beforeByKey.get(item.key)
      if (!prior) added.push(item.text)
      else if (prior.text !== item.text) modified.push({ label: item.label ?? item.key, before: prior.text, after: item.text })
    }
    const removed = before.items.filter(item => !afterKeys.has(item.key)).map(item => item.text)
    if (added.length || removed.length || modified.length) {
      changes.push({ section: section.section, change: 'modified', added, removed, modified })
    }
  }
  for (const [name, section] of a) {
    if (bNames.has(name)) continue
    changes.push({ section: name, change: 'removed', added: [], removed: section.items.map(item => item.text), modified: [] })
  }
  return changes
}

export function renderSectionChanges(changes: SectionChange[]): string {
  const out: string[] = []
  for (const change of changes) {
    out.push(`  ${change.change === 'added' ? '+' : change.change === 'removed' ? '-' : '~'} ${change.section || '(top)'}`)
    for (const text of change.added) out.push(`      + ${firstLine(text)}`)
    for (const text of change.removed) out.push(`      - ${firstLine(text)}`)
    for (const item of change.modified) {
      out.push(`      ~ ${item.label}`)
      out.push(`          was: ${firstLine(item.before)}`)
      out.push(`          now: ${firstLine(item.after)}`)
    }
  }
  return out.length ? `${out.join('\n')}\n` : ''
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]!.trim()
  return line.length > 160 ? `${line.slice(0, 157)}...` : line
}
