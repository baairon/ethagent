import { atomicWriteText } from '../../../storage/atomicWrite.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles } from '../envelope.js'
import { defaultContinuityFiles, defaultPublicSkillsJson } from './defaults.js'
import {
  ensureContinuityFiles,
  ensureContinuityVault,
  ensureTrailingNewline,
  exists,
  readContinuityFiles,
  readOrDefault,
  writeContinuityFiles,
} from './files.js'
import { syncGeneratedMarkdown } from './markdown.js'
import type { ContinuityVaultRef, IdentityMarkdownScaffold } from './types.js'

export async function ensureIdentityMarkdownScaffold(
  identity: EthagentIdentity,
  options: { publicSkillsFallback?: string | (() => Promise<string>) } = {},
): Promise<IdentityMarkdownScaffold> {
  const privateFiles = await ensureContinuityFiles(identity)
  const publicSkills = await ensurePublicSkillsFile(identity, { fallback: options.publicSkillsFallback })
  return {
    ...privateFiles,
    'skills.json': publicSkills,
  }
}

export async function writeIdentityMarkdownScaffold(
  identity: EthagentIdentity,
  files: IdentityMarkdownScaffold,
): Promise<ContinuityVaultRef> {
  const ref = await writeContinuityFiles(identity, {
    'SOUL.md': files['SOUL.md'],
    'MEMORY.md': files['MEMORY.md'],
  })
  await writePublicSkillsFile(identity, files['skills.json'])
  return ref
}

export async function syncIdentityMarkdownScaffold(identity: EthagentIdentity): Promise<IdentityMarkdownScaffold> {
  const next = await prepareSyncedIdentityMarkdownScaffold(identity)
  await writeIdentityMarkdownScaffold(identity, next)
  return next
}

export async function prepareSyncedIdentityMarkdownScaffold(identity: EthagentIdentity): Promise<IdentityMarkdownScaffold> {
  await ensureIdentityMarkdownScaffold(identity)
  const privateFiles = await readContinuityFiles(identity)
  const publicSkills = await readPublicSkillsFile(identity)
  const privateDefaults = defaultContinuityFiles(identity)
  const publicDefault = defaultPublicSkillsJson(identity)
  return {
    'SOUL.md': syncGeneratedMarkdown(privateFiles['SOUL.md'], privateDefaults['SOUL.md'], [
      { marker: 'identity' },
    ]),
    'MEMORY.md': syncGeneratedMarkdown(privateFiles['MEMORY.md'], privateDefaults['MEMORY.md'], [
      { marker: 'identity' },
    ]),
    'skills.json': syncSkillsJson(publicSkills, publicDefault),
  }
}

export async function prepareSyncedPublicSkillsJson(identity: EthagentIdentity): Promise<string> {
  await ensurePublicSkillsFile(identity)
  const publicSkills = await readPublicSkillsFile(identity)
  return syncSkillsJson(publicSkills, defaultPublicSkillsJson(identity))
}

function syncSkillsJson(existing: string, fresh: string): string {
  try {
    const existingParsed = JSON.parse(existing)
    const freshParsed = JSON.parse(fresh)
    const merged = {
      ...existingParsed,
      ...freshParsed,
      skills: existingParsed.skills || freshParsed.skills,
      inputModes: existingParsed.inputModes || freshParsed.inputModes,
      outputModes: existingParsed.outputModes || freshParsed.outputModes,
    }
    if (!Object.hasOwn(freshParsed, 'imageUrl')) delete merged.imageUrl
    return `${JSON.stringify(merged, null, 2)}\n`
  } catch {
    return fresh
  }
}

export async function ensurePublicSkillsFile(
  identity: EthagentIdentity,
  options: { fallback?: string | (() => Promise<string>) } = {},
): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  if (await exists(ref.publicSkillsPath)) return readPublicSkillsFile(identity)

  const fallback = await resolvePublicSkillsFallback(identity, options.fallback)
  await atomicWriteText(ref.publicSkillsPath, ensureTrailingNewline(fallback), { mode: 0o644 })
  return readPublicSkillsFile(identity)
}

export async function readPublicSkillsFile(identity: EthagentIdentity): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  return readOrDefault(ref.publicSkillsPath, defaultPublicSkillsJson(identity))
}

export async function writePublicSkillsFile(identity: EthagentIdentity, content: string): Promise<ContinuityVaultRef> {
  const ref = await ensureContinuityVault(identity)
  await atomicWriteText(ref.publicSkillsPath, ensureTrailingNewline(content), { mode: 0o644 })
  return ref
}

async function resolvePublicSkillsFallback(
  identity: EthagentIdentity,
  fallback: string | (() => Promise<string>) | undefined,
): Promise<string> {
  if (typeof fallback === 'string') return fallback
  if (fallback) {
    try {
      return await fallback()
    } catch {
      return defaultPublicSkillsJson(identity)
    }
  }
  return defaultPublicSkillsJson(identity)
}
