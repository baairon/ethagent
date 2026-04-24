import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { Tool } from './contracts.js'
import { resolveUserPath } from '../runtime/cwd.js'

const schema = z.object({
  path: z.string().min(1),
})

export const changeDirectoryTool: Tool<typeof schema> = {
  name: 'change_directory',
  kind: 'cd',
  description: 'Change the current working directory for subsequent tool use.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Target directory path. May be relative to the current workspace or begin with ~.' },
    },
    required: ['path'],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const fullPath = resolveTargetDirectory(context.workspaceRoot, input.path)
    return {
      kind: 'cd',
      path: fullPath,
      relativePath: path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath),
      directoryPath: path.dirname(fullPath),
      title: 'allow directory change?',
      subtitle: fullPath,
    }
  },
  async execute(input, context) {
    const fullPath = resolveTargetDirectory(context.workspaceRoot, input.path)
    const stat = await fs.stat(fullPath)
    if (!stat.isDirectory()) throw new Error(`not a directory: ${input.path}`)
    context.changeDirectory?.(fullPath)
    return {
      ok: true,
      summary: `changed directory to ${fullPath}`,
      content: fullPath,
    }
  },
}

function resolveTargetDirectory(workspaceRoot: string, requestedPath: string): string {
  return resolveDirectoryIntent(requestedPath, workspaceRoot)
}

function resolveDirectoryIntent(input: string, workspaceRoot: string): string {
  const normalized = normalizeIntentInput(input)
  if (!normalized) {
    throw new Error('missing directory path')
  }

  if (looksLikeConcretePath(normalized)) {
    return resolveUserPath(normalized, workspaceRoot)
  }

  const scoped = resolveScopedPhrase(normalized, workspaceRoot)
  if (scoped) return scoped

  const direct = resolveDirectoryHint(normalized, workspaceRoot)
  if (direct) return direct

  return resolveUserPath(normalized, workspaceRoot)
}

function resolveScopedPhrase(input: string, workspaceRoot: string): string | undefined {
  const normalized = simplifyNaturalPhrase(input)
  const parts = normalized
    .split(/\b(?:in|into|inside|under|within)\b/g)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return undefined

  const baseHint = parts.at(-1)
  if (!baseHint) return undefined
  const targetHint = parts.slice(0, -1).join(' ').trim()
  const baseDir = resolveDirectoryHint(baseHint, workspaceRoot)
  if (!baseDir) return undefined
  if (!targetHint) return baseDir

  if (looksLikeConcretePath(targetHint)) {
    return path.resolve(baseDir, targetHint)
  }

  const match = findNamedChild(baseDir, targetHint)
  if (match) return match

  const segments = targetHint
    .split(/[\\/]/)
    .map(part => part.trim())
    .filter(Boolean)
  if (segments.length === 0) return baseDir

  let current = baseDir
  for (const segment of segments) {
    const next = findNamedChild(current, segment)
    if (!next) {
      return path.join(baseDir, ...segments)
    }
    current = next
  }
  return current
}

function resolveDirectoryHint(input: string, workspaceRoot: string): string | undefined {
  const hint = simplifyNaturalPhrase(input)
  if (!hint) return undefined
  if (looksLikeConcretePath(hint)) return resolveUserPath(hint, workspaceRoot)

  const normalizedHint = hint.toLowerCase()
  const anchors = buildSearchAnchors(workspaceRoot)

  for (const candidate of anchors) {
    if (path.basename(candidate).toLowerCase() === normalizedHint) return candidate
  }

  for (const anchor of anchors) {
    const child = findNamedChild(anchor, normalizedHint)
    if (child) return child
  }

  return undefined
}

function buildSearchAnchors(workspaceRoot: string): string[] {
  const home = os.homedir()
  const seen = new Set<string>()
  const out: string[] = []
  const add = (candidate: string) => {
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) return
    seen.add(resolved)
    out.push(resolved)
  }

  for (const dir of ancestorDirectories(workspaceRoot)) add(dir)
  add(home)
  for (const child of safeReadDirectories(home)) add(child)
  return out
}

function ancestorDirectories(start: string): string[] {
  const out: string[] = []
  let current = path.resolve(start)
  while (true) {
    out.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return out
}

function findNamedChild(parent: string, nameOrPhrase: string): string | undefined {
  const wanted = simplifyNaturalPhrase(nameOrPhrase).toLowerCase()
  if (!wanted) return undefined

  const children = safeReadDirectories(parent)
  for (const child of children) {
    if (path.basename(child).toLowerCase() === wanted) return child
  }

  return undefined
}

function safeReadDirectories(dir: string): string[] {
  try {
    return fsSync.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dir, entry.name))
  } catch {
    return []
  }
}

function normalizeIntentInput(input: string): string {
  return input
    .trim()
    .replace(/\?+$/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function simplifyNaturalPhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(?:the|my)\b/g, ' ')
    .replace(/\b(?:folder|directory)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeConcretePath(input: string): boolean {
  return (
    input.startsWith('~') ||
    /^[A-Za-z]:[\\/]/.test(input) ||
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input.includes('\\') ||
    input.includes('/')
  )
}
