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
