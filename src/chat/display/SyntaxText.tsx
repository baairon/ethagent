import React from 'react'
import { Text } from 'ink'
import { styledCharsFromTokens, tokenize } from '@alcalzone/ansi-tokenize'
import { highlight, supportsLanguage, type Theme } from 'cli-highlight'
import { theme } from '../../ui/theme.js'

type Span = {
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
}

const ANSI_RESET_FG = '\x1B[39m'
const ANSI_RESET_BOLD = '\x1B[22m'
const ANSI_RESET_ITALIC = '\x1B[23m'

const HIGHLIGHT_THEME: Theme = {
  keyword: style(theme.codeKeyword, { bold: true }),
  built_in: style(theme.codeBuiltin),
  type: style(theme.codeType),
  literal: style(theme.codeKeyword),
  number: style(theme.codeNumber),
  regexp: style(theme.codeString),
  string: style(theme.codeString),
  class: style(theme.codeType),
  function: style(theme.codeFunction),
  title: style(theme.codeFunction),
  comment: style(theme.codeComment, { italic: true }),
  doctag: style(theme.codeComment, { italic: true }),
  meta: style(theme.dim),
  tag: style(theme.codeTag, { bold: true }),
  name: style(theme.codeTag, { bold: true }),
  attr: style(theme.codeAttribute),
  attribute: style(theme.codeProperty),
  variable: style(theme.codeProperty),
  addition: style(theme.diffAdded),
  deletion: style(theme.diffRemoved),
  default: style(theme.textSubtle),
}

const PROGRAMMING_LANGUAGES = new Set([
  'bash',
  'css',
  'go',
  'java',
  'javascript',
  'json',
  'python',
  'rust',
  'solidity',
  'sql',
  'typescript',
  'xml',
  'yaml',
])

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: 'javascript',
  css: 'css',
  html: 'xml',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
  yaml: 'yaml',
}

export const SyntaxLine: React.FC<{ line: string; lang?: string | null; fallbackColor?: string }> = ({
  line,
  lang,
  fallbackColor = theme.textSubtle,
}) => (
  <>
    {syntaxLineSpans(line, lang, fallbackColor).map((span, index) => (
      <Text key={index} color={span.color} bold={span.bold} italic={span.italic}>
        {span.text}
      </Text>
    ))}
  </>
)

export function syntaxLineSpans(line: string, lang?: string | null, fallbackColor: string = theme.textSubtle): Span[] {
  const code = line.length === 0 ? ' ' : line
  const language = supportedLanguage(lang)
  if (!language || !PROGRAMMING_LANGUAGES.has(language)) {
    return [{ text: code, color: fallbackColor }]
  }
  const highlighted = highlight(code, {
    language: language ?? undefined,
    ignoreIllegals: true,
    theme: HIGHLIGHT_THEME,
  })
  const spans = spansFromAnsi(highlighted)
  return spans.length > 0 ? spans : [{ text: code, color: fallbackColor }]
}

export function inferLanguageFromPath(path: string): string | null {
  const clean = path
    .replace(/^["']|["']$/g, '')
    .replace(/^[ab]\//, '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
  const extension = clean?.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase()
  return extension ? LANGUAGE_BY_EXTENSION[extension] ?? null : null
}

function supportedLanguage(lang?: string | null): string | null {
  if (!lang) return null
  const normalized = LANGUAGE_BY_EXTENSION[lang.toLowerCase()] ?? lang.toLowerCase()
  return supportsLanguage(normalized) ? normalized : null
}

function style(color: string, options: { bold?: boolean; italic?: boolean } = {}): (text: string) => string {
  return text => [
    colorCode(color),
    options.bold ? '\x1B[1m' : '',
    options.italic ? '\x1B[3m' : '',
    text,
    options.italic ? ANSI_RESET_ITALIC : '',
    options.bold ? ANSI_RESET_BOLD : '',
    ANSI_RESET_FG,
  ].join('')
}

function colorCode(hex: string): string {
  const [r, g, b] = parseHexColor(hex)
  return `\x1B[38;2;${r};${g};${b}m`
}

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '')
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ]
}

function spansFromAnsi(value: string): Span[] {
  const chars = styledCharsFromTokens(tokenize(value))
  const spans: Span[] = []
  for (const char of chars) {
    const span = spanFromCodes(char.value, char.styles.map(styleCode => styleCode.code))
    const previous = spans[spans.length - 1]
    if (previous && sameStyle(previous, span)) {
      previous.text += span.text
    } else {
      spans.push(span)
    }
  }
  return spans
}

function spanFromCodes(text: string, codes: string[]): Span {
  return {
    text,
    color: colorFromCodes(codes),
    bold: codes.includes('\x1B[1m') || undefined,
    italic: codes.includes('\x1B[3m') || undefined,
  }
}

function colorFromCodes(codes: string[]): string | undefined {
  for (let index = codes.length - 1; index >= 0; index -= 1) {
    const match = codes[index]?.match(/\x1B\[38;2;(\d+);(\d+);(\d+)m/)
    if (match) {
      return rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]))
    }
  }
  return undefined
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
}

function sameStyle(a: Span, b: Span): boolean {
  return a.color === b.color && a.bold === b.bold && a.italic === b.italic
}
