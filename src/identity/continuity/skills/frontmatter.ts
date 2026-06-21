import type { SkillFrontmatter, SkillVisibility } from './types.js'

const SUPPORTED_KEYS = new Set([
  'name',
  'description',
  'when_to_use',
  'when-to-use',
  'whenToUse',
  'version',
  'argument-hint',
  'argument_hint',
  'argumentHint',
  'tags',
  'visibility',
])

const VISIBILITY_VALUES: SkillVisibility[] = ['private', 'public']
const LEGACY_VISIBILITY_TO_PRIVATE = new Set(['discoverable'])

export type ParsedSkillFile = {
  frontmatter: SkillFrontmatter
  body: string
}

function yamlQuote(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) as number
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      out += '\\x' + code.toString(16).toUpperCase().padStart(2, '0')
    } else if (code >= 0xd800 && code <= 0xdfff) {
      out += '\\u' + code.toString(16).toUpperCase().padStart(4, '0')
    } else {
      out += ch
    }
  }
  return out + '"'
}

export function serializeSkillFile(frontmatter: SkillFrontmatter, body: string): string {
  const lines: string[] = ['---']
  if (frontmatter.name) lines.push(`name: ${yamlQuote(frontmatter.name)}`)
  if (frontmatter.description) lines.push(`description: ${yamlQuote(frontmatter.description)}`)
  if (frontmatter.whenToUse) lines.push(`when_to_use: ${yamlQuote(frontmatter.whenToUse)}`)
  if (frontmatter.version) lines.push(`version: ${yamlQuote(frontmatter.version)}`)
  if (frontmatter.argumentHint) lines.push(`argument-hint: ${yamlQuote(frontmatter.argumentHint)}`)
  if (frontmatter.tags && frontmatter.tags.length > 0) {
    lines.push(`tags: [${frontmatter.tags.map(yamlQuote).join(', ')}]`)
  }
  if (frontmatter.visibility) lines.push(`visibility: ${yamlQuote(frontmatter.visibility)}`)
  lines.push('---', '')
  const trimmedBody = body.trim()
  return lines.join('\n') + (trimmedBody ? trimmedBody + '\n' : '')
}

export function sanitizeSkillFileForStrictYaml(content: string): string {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return content
  const closeRel = normalized.slice(4).search(/^---\s*$/m)
  if (closeRel < 0) return content
  const fmText = normalized.slice(4, 4 + closeRel)
  const rest = normalized.slice(4 + closeRel)

  const out: string[] = []
  const lines = fmText.split('\n')
  let blockIndent: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (blockIndent !== null) {
      const ind = line.search(/\S/)
      if (ind === -1 || ind > blockIndent) { out.push(line); continue }
      blockIndent = null
    }
    const m = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!m) { out.push(line); continue }
    const indent = m[1] ?? ''
    const key = m[2] ?? ''
    const value = (m[3] ?? '').trim()
    if (value === '') { out.push(line); continue }
    if (/^["'[{|>&*!#]/.test(value)) {
      if (value[0] === '|' || value[0] === '>') blockIndent = indent.length
      out.push(line)
      continue
    }
    const next = lines[i + 1]
    if (next !== undefined && next.trim() !== '' && next.search(/\S/) > indent.length) { out.push(line); continue }
    out.push(`${indent}${key}: ${yamlQuote(value)}`)
  }
  return `---\n${out.join('\n')}${rest}`
}

export function parseSkillFile(content: string): ParsedSkillFile {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n') && normalized !== '---' && !normalized.startsWith('---\r')) {
    return { frontmatter: {}, body: normalized.trim() }
  }
  const afterOpen = normalized.slice(4)
  const closeIdx = afterOpen.search(/^---\s*$/m)
  if (closeIdx < 0) {
    return { frontmatter: {}, body: normalized.trim() }
  }
  const fmText = afterOpen.slice(0, closeIdx)
  const bodyText = afterOpen.slice(closeIdx).replace(/^---\s*\n?/, '').replace(/^\n+/, '')
  return {
    frontmatter: parseFrontmatterBlock(fmText),
    body: bodyText.trim(),
  }
}

function parseFrontmatterBlock(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const rawKey = match[1] ?? ''
    if (!SUPPORTED_KEYS.has(rawKey)) continue
    let rawValue = match[2] ?? ''
    if (rawValue === '' || rawValue === '|' || rawValue === '>') {
      const collected: string[] = []
      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        if (next === undefined) break
        if (next.startsWith('  ') || next.startsWith('\t')) {
          collected.push(next.replace(/^\s+/, ''))
          i++
        } else if (next === '' || next.trim() === '') {
          break
        } else {
          break
        }
      }
      rawValue = collected.join(' ').trim()
    }
    const key = normalizeKey(rawKey)
    if (!key) continue
    assignKey(out, key, rawValue)
  }
  return out
}

function normalizeKey(key: string): keyof SkillFrontmatter | null {
  switch (key) {
    case 'name': return 'name'
    case 'description': return 'description'
    case 'when_to_use':
    case 'when-to-use':
    case 'whenToUse':
      return 'whenToUse'
    case 'version': return 'version'
    case 'argument-hint':
    case 'argument_hint':
    case 'argumentHint':
      return 'argumentHint'
    case 'tags': return 'tags'
    case 'visibility': return 'visibility'
    default: return null
  }
}

function assignKey(out: SkillFrontmatter, key: keyof SkillFrontmatter, rawValue: string): void {
  const stripped = stripInlineComment(rawValue).trim()
  if (key === 'tags') {
    out.tags = parseStringList(stripped)
    return
  }
  if (key === 'visibility') {
    const literal = parseScalar(stripped).toLowerCase()
    if ((VISIBILITY_VALUES as string[]).includes(literal)) {
      out.visibility = literal as SkillVisibility
    } else if (LEGACY_VISIBILITY_TO_PRIVATE.has(literal)) {
      out.visibility = 'private'
    }
    return
  }
  const value = parseScalar(stripped)
  if (!value) return
  out[key] = value
}

function parseScalar(value: string): string {
  if (value === '') return ''
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return unescapeDoubleQuoted(value.slice(1, -1))
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  return value
}

function parseStringList(value: string): string[] {
  if (!value) return []
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1)
    return splitListItems(inner)
      .map(parseScalar)
      .filter(item => item.length > 0)
  }
  return splitListItems(value)
    .map(parseScalar)
    .filter(item => item.length > 0)
}

function splitListItems(value: string): string[] {
  const items: string[] = []
  let buffer = ''
  let quote: string | null = null
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quote) {
      buffer += ch
      if (ch === quote && value[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buffer += ch
      continue
    }
    if (ch === ',') {
      items.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += ch
  }
  if (buffer.trim()) items.push(buffer.trim())
  return items
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(["\\/bfnrt])/g, (_, c) => {
    switch (c) {
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      case 'b': return '\b'
      case 'f': return '\f'
      default: return c
    }
  })
}

function stripInlineComment(value: string): string {
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith('[')) return value
  const hash = value.indexOf(' #')
  return hash === -1 ? value : value.slice(0, hash)
}
