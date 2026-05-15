import type { ContinuitySkillsTree } from './envelope.js'

const PRIVATE_SKILL_FILE_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/
const PRIVATE_SKILL_LAST_SEG_FILE_RE = /^[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/
const LEGACY_NESTED_SKILL_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/.+$/
const LEGACY_FLAT_NAME_MD_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.md$/i
const MAX_PRIVATE_SKILL_ENTRIES = 500
const MAX_PRIVATE_SKILL_BODY_BYTES = 256 * 1024
const MAX_PRIVATE_SKILL_PATH_LEN = 256

export function normalizeContinuitySkills(input: unknown): ContinuitySkillsTree | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Record<string, unknown>
  const out: ContinuitySkillsTree = {}
  let count = 0
  const tryInsert = (key: string, rawValue: unknown): void => {
    if (count >= MAX_PRIVATE_SKILL_ENTRIES) return
    if (typeof rawValue !== 'string') return
    if (key.length === 0 || key.length > MAX_PRIVATE_SKILL_PATH_LEN) return
    if (key.includes('\0')) return
    if (key.includes('..')) return
    if (key.startsWith('/')) return
    if (/^[A-Za-z]:/.test(key)) return
    if (!isAcceptableSkillKey(key)) return
    if (Buffer.byteLength(rawValue, 'utf8') > MAX_PRIVATE_SKILL_BODY_BYTES) return
    if (out[key] !== undefined) return
    out[key] = rawValue
    count++
  }
  const legacyRoots = new Set<string>()
  const realSkillFolders = new Set<string>()
  for (const rawKey of Object.keys(obj)) {
    const key = rawKey.replace(/\\/g, '/')
    const segments = key.split('/')
    if (segments.length === 3 && segments[2] === 'SKILL.md' && segments[0] && segments[1]) {
      legacyRoots.add(`${segments[0]}/${segments[1]}`)
    }
    if (segments.length === 2 && segments[1] === 'SKILL.md' && segments[0]) {
      realSkillFolders.add(segments[0])
    }
  }
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = rawKey.replace(/\\/g, '/')
    if (!isCanonicalFlatKey(key)) continue
    if (isUnderLegacyRoot(key, legacyRoots)) continue
    if (!keyHasRealSkillFolder(key, realSkillFolders)) continue
    tryInsert(key, rawValue)
  }
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = rawKey.replace(/\\/g, '/')
    if (
      isCanonicalFlatKey(key)
      && !isUnderLegacyRoot(key, legacyRoots)
      && keyHasRealSkillFolder(key, realSkillFolders)
    ) continue
    const upgraded = upgradeLegacySkillKey(key, legacyRoots)
    if (!upgraded) continue
    tryInsert(upgraded, rawValue)
  }
  return count > 0 ? out : undefined
}

function isUnderLegacyRoot(key: string, legacyRoots: Set<string>): boolean {
  for (const root of legacyRoots) {
    if (key === `${root}/SKILL.md`) return true
    if (key.startsWith(`${root}/`)) return true
  }
  return false
}

function keyHasRealSkillFolder(key: string, realSkillFolders: Set<string>): boolean {
  const first = key.split('/')[0]
  if (!first) return false
  return realSkillFolders.has(first)
}

function isCanonicalFlatKey(key: string): boolean {
  if (!PRIVATE_SKILL_FILE_RE.test(key)) return false
  const segments = key.split('/')
  if (segments.length < 2) return false
  const last = segments[segments.length - 1]!
  if (last === 'SKILL.md') return segments.length === 2
  return PRIVATE_SKILL_LAST_SEG_FILE_RE.test(last)
}

function isAcceptableSkillKey(key: string): boolean {
  return isCanonicalFlatKey(key)
}

function upgradeLegacySkillKey(key: string, legacyRoots: Set<string>): string | null {
  for (const root of legacyRoots) {
    if (key === `${root}/SKILL.md` || key.startsWith(`${root}/`)) {
      const [first, second] = root.split('/')
      if (!first || !second) continue
      const rest = key.slice(root.length + 1)
      const flattened = `${first}-${second}/${rest}`
      return isCanonicalFlatKey(flattened) ? flattened : null
    }
  }
  if (LEGACY_FLAT_NAME_MD_RE.test(key)) {
    const [category, file] = key.split('/')
    if (!category || !file) return null
    const slug = file.replace(/\.md$/i, '')
    if (!slug) return null
    const flattened = `${category}-${slug}/SKILL.md`
    return isCanonicalFlatKey(flattened) ? flattened : null
  }
  if (LEGACY_NESTED_SKILL_RE.test(key)) {
    const segments = key.split('/')
    if (segments.length < 3) return null
    const [first, second, ...rest] = segments
    if (!first || !second || rest.length === 0) return null
    const flattened = `${first}-${second}/${rest.join('/')}`
    return isCanonicalFlatKey(flattened) ? flattened : null
  }
  if (isCanonicalFlatKey(key)) return key
  return null
}
