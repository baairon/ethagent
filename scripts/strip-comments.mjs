#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import ts from 'typescript'

const ROOTS = ['src', 'test', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '.git', 'lib', 'out'])
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const KEEP_PATTERNS = [
  /^\s*\/[/*]\s*eslint-/,
  /^\s*\/\/\s*@ts-(ignore|expect-error|check|nocheck)/,
  /^\s*\/\*\s*@ts-(ignore|expect-error|check|nocheck)/,
  /^\s*\/\/\s*prettier-ignore/,
  /^\s*\/\*\s*prettier-ignore/,
  /^#!/,
  /^\s*\/[/*]\s*biome-ignore/,
  /^\s*\/[/*]\s*@vitest-/,
  /^\s*\/[/*]\s*@jest-/,
  /^\s*\/\/\s*@__PURE__/,
  /^\s*\/\*\s*@__PURE__/,
  /^\s*\/\*!\s*/,
]

function shouldKeep(commentText) {
  return KEEP_PATTERNS.some(p => p.test(commentText))
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      if (EXTENSIONS.has(extname(entry.name))) {
        yield full
      }
    }
  }
}

function collectCommentRanges(text, scriptKind) {
  const sf = ts.createSourceFile('temp', text, ts.ScriptTarget.Latest, true, scriptKind)
  const seen = new Set()
  const ranges = []
  function visit(node) {
    ts.forEachLeadingCommentRange(text, node.getFullStart(), (pos, end, kind) => {
      const key = pos + ':' + end
      if (!seen.has(key)) {
        seen.add(key)
        ranges.push({ pos, end, kind })
      }
    })
    ts.forEachTrailingCommentRange(text, node.getEnd(), (pos, end, kind) => {
      const key = pos + ':' + end
      if (!seen.has(key)) {
        seen.add(key)
        ranges.push({ pos, end, kind })
      }
    })
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return ranges
}

function isCommentInsideJsxExpression(text, pos, end) {
  let i = pos - 1
  while (i >= 0 && /\s/.test(text[i])) i--
  if (i < 0 || text[i] !== '{') return false
  let j = end
  while (j < text.length && /\s/.test(text[j])) j++
  if (j >= text.length || text[j] !== '}') return false
  return { braceOpen: i, braceClose: j }
}

function stripComments(text, scriptKind) {
  const ranges = collectCommentRanges(text, scriptKind)
  const removals = []
  for (const r of ranges) {
    const t = text.slice(r.pos, r.end)
    if (shouldKeep(t)) continue
    const jsx = isCommentInsideJsxExpression(text, r.pos, r.end)
    if (jsx) {
      removals.push({ pos: jsx.braceOpen, end: jsx.braceClose + 1, jsx: true })
    } else {
      removals.push({ pos: r.pos, end: r.end, jsx: false })
    }
  }
  removals.sort((a, b) => b.pos - a.pos)
  let result = text
  for (const r of removals) {
    const before = result.slice(0, r.pos)
    const after = result.slice(r.end)
    const lastNewline = before.lastIndexOf('\n')
    const beforeOnLine = before.slice(lastNewline + 1)
    const lineOnlyWhitespace = /^\s*$/.test(beforeOnLine)
    if (lineOnlyWhitespace) {
      const nextNewline = after.indexOf('\n')
      if (nextNewline !== -1) {
        result = before.slice(0, lastNewline + 1) + after.slice(nextNewline + 1)
      } else {
        result = before.slice(0, lastNewline + 1) + after
      }
    } else {
      const trimmedBefore = before.replace(/[ \t]+$/, '')
      result = trimmedBefore + after
    }
  }
  result = result.replace(/\n{3,}/g, '\n\n')
  if (result.length > 0 && !result.endsWith('\n')) result += '\n'
  return result
}

function scriptKindFor(path) {
  const ext = extname(path).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.ts') return ts.ScriptKind.TS
  if (ext === '.jsx') return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

const cwd = process.cwd()
let touched = 0
let scanned = 0
let totalRemoved = 0
for (const root of ROOTS) {
  const rootPath = join(cwd, root)
  try {
    statSync(rootPath)
  } catch {
    continue
  }
  for (const file of walk(rootPath)) {
    scanned++
    const original = readFileSync(file, 'utf8')
    const stripped = stripComments(original, scriptKindFor(file))
    if (stripped !== original) {
      writeFileSync(file, stripped, 'utf8')
      const delta = original.length - stripped.length
      totalRemoved += delta
      touched++
      const rel = relative(cwd, file).replace(/\\/g, '/')
      process.stdout.write(`stripped ${rel} (-${delta} chars)\n`)
    }
  }
}
process.stdout.write(`\nScanned ${scanned} files, modified ${touched}, removed ${totalRemoved} chars\n`)
