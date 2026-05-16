import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../../../storage/atomicWrite.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import { ensureContinuityVault } from '../storage/files.js'
import { continuityVaultRef } from '../storage/paths.js'
import { parseSkillFile } from './frontmatter.js'
import { defaultSkillScaffold } from './scaffold.js'
import {
  isReservedWindowsSegment,
  isValidFilenameSegment,
  isValidSegment,
  isValidSkillEntryKey,
  isValidSkillFilePath,
  isWithin,
  MAX_FOLDER_DEPTH,
  SKILL_FILE_NAME,
} from './skillPaths.js'
import type {
  ContinuitySkillsTree,
  Skill,
  SkillIndexEntry,
  SkillVisibility,
} from './types.js'

const MAX_SKILL_ENTRIES = 200
const MAX_SKILL_FILE_BYTES = 256 * 1024
const MAX_TREE_FILES = 500

type IdentityKey = Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'agentId' | 'address'>

type CacheEntry = {
  fingerprint: string
  entries: SkillIndexEntry[]
}

const cache = new Map<string, CacheEntry>()

function vaultKey(identity: IdentityKey): string {
  return continuityVaultRef(identity).dir
}

export function invalidateSkillsCache(identity: IdentityKey): void {
  cache.delete(vaultKey(identity))
}

export async function listSkills(identity: EthagentIdentity): Promise<SkillIndexEntry[]> {
  const ref = await ensureContinuityVault(identity)
  await migrateLegacySkillFiles(ref.skillsDir)
  const key = ref.dir
  const stat = await statOrNull(ref.skillsDir)
  if (!stat) return []
  const fingerprint = await skillsTreeFingerprint(ref.skillsDir)
  if (fingerprint === '') return []
  const cached = cache.get(key)
  if (cached && cached.fingerprint === fingerprint) return cached.entries
  const entries = await collectSkillEntries(ref.skillsDir)
  cache.set(key, { fingerprint, entries })
  return entries
}

export type SkillsTreeView = {
  skills: SkillIndexEntry[]
  supportingCounts: Record<string, number>
}

export async function listSkillsTree(identity: EthagentIdentity): Promise<SkillsTreeView> {
  const skills = await listSkills(identity)
  const supportingCounts: Record<string, number> = {}
  for (const skill of skills) {
    const files = await listSkillFiles(identity, skill.name).catch(() => [])
    const extras = files.filter(f => f.relativePath !== SKILL_FILE_NAME).length
    if (extras > 0) supportingCounts[skill.name] = extras
  }
  return { skills, supportingCounts }
}

export type SkillFileEntry = {
  relativePath: string
  absolutePath: string
  sizeBytes: number
  mtimeMs: number
}

export async function listSkillFiles(
  identity: EthagentIdentity,
  skillName: string,
): Promise<SkillFileEntry[]> {
  if (!isValidSegment(skillName)) throw new Error('skill name is invalid')
  const ref = await ensureContinuityVault(identity)
  const skillDir = path.join(ref.skillsDir, skillName)
  if (!isWithin(ref.skillsDir, skillDir)) throw new Error('skill path escapes the vault')
  const stat = await statOrNull(skillDir)
  if (!stat || !stat.isDirectory()) return []
  const out: SkillFileEntry[] = []
  await walkFolderFiles(skillDir, '', 0, out)
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return out
}

async function skillsTreeFingerprint(root: string): Promise<string> {
  const leaves = await walkSkillFileStats(root)
  if (leaves.length === 0) return ''
  leaves.sort((a, b) => a.rel.localeCompare(b.rel))
  return leaves.map(l => `${l.rel}|${l.mtimeMs}|${l.size}`).join('\n')
}

type SkillFileStat = { rel: string; mtimeMs: number; size: number }

async function walkSkillFileStats(root: string): Promise<SkillFileStat[]> {
  const out: SkillFileStat[] = []
  let skillDirents: import('node:fs').Dirent[]
  try {
    skillDirents = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const skillEnt of skillDirents) {
    if (out.length >= MAX_TREE_FILES) break
    if (!skillEnt.isDirectory() || skillEnt.isSymbolicLink()) continue
    if (!isValidSegment(skillEnt.name)) continue
    const skillDir = path.join(root, skillEnt.name)
    const skillFile = path.join(skillDir, SKILL_FILE_NAME)
    if (!(await pathExists(skillFile))) continue
    const files: SkillFileEntry[] = []
    await walkFolderFiles(skillDir, '', 0, files)
    for (const file of files) {
      if (out.length >= MAX_TREE_FILES) break
      out.push({
        rel: `${skillEnt.name}/${file.relativePath}`,
        mtimeMs: file.mtimeMs,
        size: file.sizeBytes,
      })
    }
  }
  return out
}

export async function readSkill(identity: EthagentIdentity, name: string): Promise<Skill> {
  const entries = await listSkills(identity)
  const lookup = name.replace(/^.*:/, '').replace(/:SKILL$/i, '')
  const match = entries.find(entry =>
    entry.name === name
    || entry.name === lookup
    || entry.displayName === name
    || entry.displayName === lookup,
  )
  if (!match) throw new Error(`unknown private skill: ${name}`)
  return loadSkillBody(match)
}

export async function readSkillByRelativePath(
  identity: EthagentIdentity,
  relativePath: string,
): Promise<Skill> {
  const ref = await ensureContinuityVault(identity)
  const normalized = relativePath.replace(/\\/g, '/')
  if (!isValidSkillEntryKey(normalized)) throw new Error('skill path is not allowed')
  const absolute = path.resolve(ref.skillsDir, normalized)
  if (!isWithin(ref.skillsDir, absolute)) throw new Error('skill path escapes vault')
  const stat = await statOrNull(absolute)
  if (!stat || !stat.isFile()) throw new Error(`skill not found: ${relativePath}`)
  const raw = await fs.readFile(absolute, 'utf8')
  const parsed = parseSkillFile(raw)
  const entry = buildIndexEntry({
    relativePath: normalized,
    absolutePath: absolute,
    parsed,
  })
  return { ...entry, body: parsed.body }
}

export async function readSkillFile(
  identity: EthagentIdentity,
  skillName: string,
  filePath: string,
): Promise<{ relativePath: string; absolutePath: string; content: string }> {
  if (!isValidSegment(skillName)) throw new Error('skill name is invalid')
  const ref = await ensureContinuityVault(identity)
  const skillDir = path.join(ref.skillsDir, skillName)
  const normalizedFile = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const rel = `${skillName}/${normalizedFile}`
  if (!isValidSkillFilePath(rel)) throw new Error('skill file path is not allowed')
  const absolute = path.resolve(skillDir, normalizedFile)
  if (!isWithin(ref.skillsDir, absolute)) throw new Error('skill file path escapes the vault')
  const stat = await statOrNull(absolute)
  if (!stat || !stat.isFile()) throw new Error(`skill file not found: ${rel}`)
  if (stat.size > MAX_SKILL_FILE_BYTES) throw new Error(`skill file too large: ${rel}`)
  const content = await fs.readFile(absolute, 'utf8')
  return { relativePath: rel, absolutePath: absolute, content }
}

export async function loadSkillsTree(identity: EthagentIdentity): Promise<ContinuitySkillsTree> {
  const ref = await ensureContinuityVault(identity)
  await migrateLegacySkillFiles(ref.skillsDir)
  const tree: ContinuitySkillsTree = {}
  let categoryDirents: import('node:fs').Dirent[]
  try {
    categoryDirents = await fs.readdir(ref.skillsDir, { withFileTypes: true })
  } catch {
    return tree
  }
  let totalFiles = 0
  for (const skillEnt of categoryDirents) {
    if (totalFiles >= MAX_TREE_FILES) break
    if (!skillEnt.isDirectory() || skillEnt.isSymbolicLink()) continue
    if (!isValidSegment(skillEnt.name)) continue
    const skillDir = path.join(ref.skillsDir, skillEnt.name)
    const entryFile = path.join(skillDir, SKILL_FILE_NAME)
    if (!(await pathExists(entryFile))) continue
    const files: SkillFileEntry[] = []
    await walkFolderFiles(skillDir, '', 0, files)
    for (const file of files) {
      if (totalFiles >= MAX_TREE_FILES) break
      const rel = `${skillEnt.name}/${file.relativePath}`
      if (!isValidSkillFilePath(rel)) continue
      if (file.sizeBytes > MAX_SKILL_FILE_BYTES) continue
      const rawContent = await fs.readFile(file.absolutePath, 'utf8').catch(() => null)
      if (rawContent === null) continue
      const content = file.relativePath === SKILL_FILE_NAME
        ? await ensureSkillVisibilityWritten(file.absolutePath, rawContent)
        : rawContent
      tree[rel] = content
      totalFiles++
    }
  }
  return tree
}

export async function materializeSkillsTree(
  identity: EthagentIdentity,
  tree: ContinuitySkillsTree | undefined,
): Promise<void> {
  if (!tree) return
  const ref = await ensureContinuityVault(identity)
  for (const [rawRel, content] of Object.entries(tree)) {
    const rel = rawRel.replace(/\\/g, '/')
    if (!isValidSkillFilePath(rel)) continue
    if (typeof content !== 'string') continue
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) continue
    const absolute = path.resolve(ref.skillsDir, rel)
    if (!isWithin(ref.skillsDir, absolute)) continue
    await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 })
    await atomicWriteText(absolute, content, { mode: 0o600 })
  }
  invalidateSkillsCache(identity)
}

export type CreateSkillArgs = {
  name: string
  body?: string
  visibility?: SkillVisibility
}

export type CreateSkillResult = {
  relativePath: string
  absolutePath: string
  displayName: string
}

export async function createSkillFile(
  identity: EthagentIdentity,
  args: CreateSkillArgs,
): Promise<CreateSkillResult> {
  if (!isValidSegment(args.name)) throw new Error('folder name must contain only letters, digits, dots, dashes, or underscores')
  const ref = await ensureContinuityVault(identity)
  await migrateLegacySkillFiles(ref.skillsDir)
  const skillDir = path.join(ref.skillsDir, args.name)
  const file = path.join(skillDir, SKILL_FILE_NAME)
  const relativePath = `${args.name}/${SKILL_FILE_NAME}`
  if (await pathExists(file)) {
    throw new Error(`skill already exists at ${relativePath}`)
  }
  const skillDirExisted = await pathExists(skillDir)
  await fs.mkdir(skillDir, { recursive: true, mode: 0o700 })
  const body = args.body ?? defaultSkillScaffold({ name: args.name, ...(args.visibility ? { visibility: args.visibility } : {}) })
  try {
    await atomicWriteText(file, body, { mode: 0o600 })
  } catch (err) {
    if (!skillDirExisted) {
      await fs.rm(skillDir, { recursive: true, force: true }).catch(() => null)
    }
    throw err
  }
  invalidateSkillsCache(identity)
  return {
    relativePath,
    absolutePath: file,
    displayName: args.name,
  }
}

export async function setSkillVisibility(
  identity: EthagentIdentity,
  relativePath: string,
  visibility: SkillVisibility,
): Promise<void> {
  const ref = await ensureContinuityVault(identity)
  const normalized = relativePath.replace(/\\/g, '/')
  if (!isValidSkillEntryKey(normalized)) throw new Error('skill path is not allowed')
  const absolute = path.resolve(ref.skillsDir, normalized)
  if (!isWithin(ref.skillsDir, absolute)) throw new Error('skill path escapes the vault')
  const stat = await statOrNull(absolute)
  if (!stat || !stat.isFile()) throw new Error(`skill not found: ${normalized}`)
  const raw = await fs.readFile(absolute, 'utf8')
  const next = rewriteVisibility(raw, visibility)
  if (next === raw) return
  await atomicWriteText(absolute, next, { mode: 0o600 })
  invalidateSkillsCache(identity)
}

function rewriteVisibility(raw: string, visibility: SkillVisibility): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  if (!normalized.startsWith('---\n')) {
    return `---\nvisibility: ${visibility}\n---\n\n${normalized.replace(/^\n+/, '')}`
  }
  const afterOpen = normalized.slice(4)
  const closeMatch = afterOpen.match(/^---\s*$/m)
  if (!closeMatch || closeMatch.index === undefined) {
    return `---\nvisibility: ${visibility}\n---\n\n${normalized.replace(/^---\n/, '')}`
  }
  const closeIdx = closeMatch.index
  const fmText = afterOpen.slice(0, closeIdx)
  const rest = afterOpen.slice(closeIdx)
  const lines = fmText.split('\n')
  let replaced = false
  const updated = lines.map(line => {
    if (replaced) return line
    if (/^\s*visibility\s*:/.test(line)) {
      replaced = true
      return `visibility: ${visibility}`
    }
    return line
  })
  if (!replaced) {
    while (updated.length > 0 && updated[updated.length - 1] === '') updated.pop()
    updated.push(`visibility: ${visibility}`)
    updated.push('')
  }
  return `---\n${updated.join('\n')}${rest}`
}

export async function deleteSkillEntry(identity: EthagentIdentity, relativePath: string): Promise<void> {
  const ref = await ensureContinuityVault(identity)
  const normalized = relativePath.replace(/\\/g, '/')
  if (!isValidSkillEntryKey(normalized)) throw new Error('skill path is not allowed')
  const skillFile = path.resolve(ref.skillsDir, normalized)
  if (!isWithin(ref.skillsDir, skillFile)) throw new Error('skill path escapes the vault')
  const skillDir = path.dirname(skillFile)
  if (!isWithin(ref.skillsDir, skillDir) || skillDir === ref.skillsDir) {
    throw new Error('skill path escapes the vault')
  }
  await fs.rm(skillDir, { recursive: true, force: true })
  invalidateSkillsCache(identity)
}

export async function migrateLegacySkillFiles(skillsRoot: string): Promise<void> {
  let topDirents: import('node:fs').Dirent[]
  try {
    topDirents = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const topEnt of topDirents) {
    if (topEnt.isSymbolicLink()) continue
    if (topEnt.isFile() && /\.md$/i.test(topEnt.name)) {
      await adoptBareSkillFile(skillsRoot, topEnt.name)
      continue
    }
    if (!topEnt.isDirectory()) continue
    if (!isValidSegment(topEnt.name)) continue
    const topDir = path.join(skillsRoot, topEnt.name)
    let children: import('node:fs').Dirent[]
    try {
      children = await fs.readdir(topDir, { withFileTypes: true })
    } catch {
      continue
    }
    const skillFileHere = path.join(topDir, SKILL_FILE_NAME)
    if (await pathExists(skillFileHere)) continue
    for (const child of children) {
      if (child.isSymbolicLink()) continue
      if (child.isFile() && /^[A-Za-z0-9._-]+\.md$/i.test(child.name) && !/^SKILL\.md$/i.test(child.name)) {
        const slug = child.name.replace(/\.md$/i, '')
        if (!isValidSegment(slug)) continue
        const target = await chooseFlatTarget(skillsRoot, `${topEnt.name}-${slug}`)
        const targetDir = path.join(skillsRoot, target)
        const targetFile = path.join(targetDir, SKILL_FILE_NAME)
        try {
          await fs.mkdir(targetDir, { recursive: true, mode: 0o700 })
          await fs.rename(path.join(topDir, child.name), targetFile)
        } catch {
          continue
        }
        continue
      }
      if (child.isDirectory() && isValidSegment(child.name)) {
        const oldSkillDir = path.join(topDir, child.name)
        const nestedSkillFile = path.join(oldSkillDir, SKILL_FILE_NAME)
        if (!(await pathExists(nestedSkillFile))) continue
        const target = await chooseFlatTarget(skillsRoot, `${topEnt.name}-${child.name}`)
        const targetDir = path.join(skillsRoot, target)
        try {
          await fs.rename(oldSkillDir, targetDir)
        } catch {
          continue
        }
      }
    }
    await removeIfEmpty(topDir)
  }
}

async function adoptBareSkillFile(skillsRoot: string, fileName: string): Promise<void> {
  const sourcePath = path.join(skillsRoot, fileName)
  let baseName: string
  if (/^SKILL\.md$/i.test(fileName)) {
    let parsedName: string | undefined
    try {
      const raw = await fs.readFile(sourcePath, 'utf8')
      const parsed = parseSkillFile(raw)
      const fmName = parsed.frontmatter.name?.trim()
      if (fmName && isValidSegment(fmName)) parsedName = fmName
    } catch {
    }
    baseName = parsedName ?? 'imported-skill'
  } else {
    const slug = fileName.replace(/\.md$/i, '')
    if (!isValidSegment(slug)) return
    baseName = slug
  }
  let target: string
  try {
    target = await chooseFlatTarget(skillsRoot, baseName)
  } catch {
    return
  }
  const targetDir = path.join(skillsRoot, target)
  const targetFile = path.join(targetDir, SKILL_FILE_NAME)
  try {
    await fs.mkdir(targetDir, { recursive: true, mode: 0o700 })
    await fs.rename(sourcePath, targetFile)
  } catch {
  }
}

async function chooseFlatTarget(skillsRoot: string, base: string): Promise<string> {
  let candidate = base
  let suffix = 2
  while (await pathExists(path.join(skillsRoot, candidate))) {
    candidate = `${base}-${suffix}`
    suffix++
    if (suffix > 99) throw new Error(`cannot find unused name for legacy skill: ${base}`)
  }
  return candidate
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir)
    if (entries.length === 0) await fs.rmdir(dir).catch(() => null)
  } catch {
  }
}

async function walkFolderFiles(
  root: string,
  relativePrefix: string,
  depth: number,
  out: SkillFileEntry[],
): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH) return
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await fs.readdir(path.join(root, relativePrefix), { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of dirents) {
    if (ent.isSymbolicLink()) continue
    if (ent.name.startsWith('.')) continue
    if (isReservedWindowsSegment(ent.name)) continue
    if (ent.isDirectory()) {
      if (!isValidSegment(ent.name)) continue
      const nextPrefix = relativePrefix ? `${relativePrefix}/${ent.name}` : ent.name
      await walkFolderFiles(root, nextPrefix, depth + 1, out)
      continue
    }
    if (!ent.isFile()) continue
    if (!isValidFilenameSegment(ent.name)) continue
    const absolutePath = path.join(root, relativePrefix, ent.name)
    const stat = await fs.stat(absolutePath).catch(() => null)
    if (!stat) continue
    out.push({
      relativePath: relativePrefix ? `${relativePrefix}/${ent.name}` : ent.name,
      absolutePath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
    })
  }
}

async function statOrNull(file: string): Promise<import('node:fs').Stats | null> {
  try {
    return await fs.stat(file)
  } catch {
    return null
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

const DEFAULT_PASTED_VISIBILITY: SkillVisibility = 'public'
const LEGACY_DISCOVERABLE_RE = /^\s*visibility\s*:\s*['"]?discoverable['"]?\s*$/im

async function ensureSkillVisibilityWritten(skillFile: string, raw: string): Promise<string> {
  let parsed: { frontmatter: import('./types.js').SkillFrontmatter; body: string }
  try {
    parsed = parseSkillFile(raw)
  } catch {
    return raw
  }
  let target: SkillVisibility | null = null
  if (LEGACY_DISCOVERABLE_RE.test(raw)) {
    target = 'private'
  } else if (parsed.frontmatter.visibility === undefined) {
    target = DEFAULT_PASTED_VISIBILITY
  }
  if (target === null) return raw
  const next = rewriteVisibility(raw, target)
  if (next === raw) return raw
  try {
    await atomicWriteText(skillFile, next, { mode: 0o600 })
  } catch {
  }
  return next
}

async function collectSkillEntries(root: string): Promise<SkillIndexEntry[]> {
  const out: SkillIndexEntry[] = []
  let topDirents: import('node:fs').Dirent[]
  try {
    topDirents = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const skillEnt of topDirents) {
    if (out.length >= MAX_SKILL_ENTRIES) break
    if (!skillEnt.isDirectory() || skillEnt.isSymbolicLink()) continue
    if (!isValidSegment(skillEnt.name)) continue
    const skillFile = path.join(root, skillEnt.name, SKILL_FILE_NAME)
    try {
      const stat = await fs.stat(skillFile)
      if (!stat.isFile()) continue
      if (stat.size > MAX_SKILL_FILE_BYTES) continue
      const rawInitial = await fs.readFile(skillFile, 'utf8')
      const raw = await ensureSkillVisibilityWritten(skillFile, rawInitial)
      const parsed = parseSkillFile(raw)
      const relativePath = `${skillEnt.name}/${SKILL_FILE_NAME}`
      out.push(buildIndexEntry({
        relativePath,
        absolutePath: skillFile,
        parsed,
      }))
    } catch {
      continue
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function buildIndexEntry(args: {
  relativePath: string
  absolutePath: string
  parsed: { frontmatter: import('./types.js').SkillFrontmatter; body: string }
}): SkillIndexEntry {
  const segments = args.relativePath.split('/')
  const folder = segments[0] ?? ''
  const derivedName = folder || segments.join('/')
  const fm = args.parsed.frontmatter
  const description = pickDescription(fm.description, args.parsed.body)
  const visibility: SkillVisibility = fm.visibility ?? DEFAULT_PASTED_VISIBILITY
  return {
    name: derivedName,
    ...(fm.name ? { displayName: fm.name } : {}),
    description,
    ...(fm.whenToUse ? { whenToUse: fm.whenToUse } : {}),
    ...(fm.version ? { version: fm.version } : {}),
    ...(fm.argumentHint ? { argumentHint: fm.argumentHint } : {}),
    ...(fm.tags && fm.tags.length > 0 ? { tags: fm.tags } : {}),
    visibility,
    relativePath: args.relativePath,
    absolutePath: args.absolutePath,
  }
}

function pickDescription(fromFrontmatter: string | undefined, body: string): string {
  if (fromFrontmatter && fromFrontmatter.trim()) return fromFrontmatter.trim()
  for (const line of body.split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim()
    if (trimmed) return trimmed.slice(0, 280)
  }
  return ''
}

async function loadSkillBody(entry: SkillIndexEntry): Promise<Skill> {
  const raw = await fs.readFile(entry.absolutePath, 'utf8')
  const parsed = parseSkillFile(raw)
  return { ...entry, body: parsed.body }
}

export { isValidSkillEntryKey, isValidSkillFilePath } from './skillPaths.js'
