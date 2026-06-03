import path from 'node:path'

export const SKILL_FILE_NAME = 'SKILL.md'
export const MAX_FOLDER_DEPTH = 4

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/
const FILE_EXT_RE = /\.[A-Za-z0-9]+$/
const RESERVED_WINDOWS_SEGMENTS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

export function isReservedWindowsSegment(name: string): boolean {
  // Windows reserves these device names with ANY extension (nul.md, con.txt, com1.json, ...),
  // so compare the base name before the first dot, not the whole filename. Otherwise a file
  // like nul.md slips through and fs.copyFile throws, aborting the entire skill mirror on Windows.
  const base = name.toLowerCase().split('.')[0] ?? ''
  return RESERVED_WINDOWS_SEGMENTS.has(base)
}

export function isValidSegment(name: string): boolean {
  if (!name) return false
  if (name.startsWith('.')) return false
  if (isReservedWindowsSegment(name)) return false
  return SEGMENT_RE.test(name)
}

export function isValidFilenameSegment(name: string): boolean {
  if (!name) return false
  if (name.startsWith('.')) return false
  if (isReservedWindowsSegment(name)) return false
  if (!SEGMENT_RE.test(name)) return false
  return FILE_EXT_RE.test(name)
}

export function isValidSkillEntryKey(rel: string): boolean {
  if (!rel || rel.length > 256) return false
  if (rel.includes('\0')) return false
  if (rel.startsWith('/') || rel.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(rel)) return false
  const segments = rel.split('/')
  if (segments.length !== 2) return false
  const [name, filename] = segments
  if (!name || !filename) return false
  if (filename !== SKILL_FILE_NAME) return false
  if (!isValidSegment(name)) return false
  return true
}

export function isValidSkillFilePath(rel: string): boolean {
  if (!rel || rel.length > 256) return false
  if (rel.includes('\0')) return false
  if (rel.startsWith('/') || rel.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(rel)) return false
  const segments = rel.split('/')
  if (segments.length < 2) return false
  if (segments.length > MAX_FOLDER_DEPTH + 2) return false
  const [first, ...rest] = segments
  if (!first || !isValidSegment(first)) return false
  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i]
    if (!seg) return false
    if (i === rest.length - 1) {
      if (seg === SKILL_FILE_NAME) continue
      if (!isValidFilenameSegment(seg)) return false
    } else {
      if (!isValidSegment(seg)) return false
    }
  }
  return true
}

export function isWithin(root: string, target: string): boolean {
  const rootResolved = path.resolve(root)
  const targetResolved = path.resolve(target)
  if (targetResolved === rootResolved) return true
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep
  return targetResolved.startsWith(prefix)
}
