import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../../../storage/atomicWrite.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles, ContinuitySkillsTree } from '../envelope.js'
import {
  loadSkillsTree,
  materializeSkillsTree,
} from '../skills/loadSkills.js'
import {
  renderAgentCardJsonForIdentity,
  syncAgentCardManifest,
} from '../skills/publicSkillsSync.js'
import { defaultContinuityFiles, defaultAgentCardJson } from './defaults.js'
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
  options: { agentCardFallback?: string | (() => Promise<string>) } = {},
): Promise<IdentityMarkdownScaffold> {
  const privateFiles = await ensureContinuityFiles(identity)
  const agentCard = await ensureAgentCardFile(identity, { fallback: options.agentCardFallback })
  const syncedCard = await syncAgentCardManifest(identity).catch(() => agentCard)
  return {
    ...privateFiles,
    'agent-card.json': syncedCard,
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
  await writeAgentCardFile(identity, files['agent-card.json'])
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
  const privateDefaults = defaultContinuityFiles(identity)
  const agentCardDefault = await renderAgentCardJsonForIdentity(identity)
  return {
    'SOUL.md': syncGeneratedMarkdown(privateFiles['SOUL.md'], privateDefaults['SOUL.md'], [
      { marker: 'identity' },
    ]),
    'MEMORY.md': syncGeneratedMarkdown(privateFiles['MEMORY.md'], privateDefaults['MEMORY.md'], [
      { marker: 'identity' },
    ]),
    'agent-card.json': agentCardDefault,
  }
}

export async function prepareSyncedAgentCardJson(identity: EthagentIdentity): Promise<string> {
  await ensureAgentCardFile(identity)
  return renderAgentCardJsonForIdentity(identity)
}

export async function prepareSyncedSkillsTree(identity: EthagentIdentity): Promise<ContinuitySkillsTree> {
  await ensureContinuityVault(identity)
  return loadSkillsTree(identity)
}

export async function restoreSkillsTree(
  identity: EthagentIdentity,
  tree: ContinuitySkillsTree | undefined,
): Promise<void> {
  await materializeSkillsTree(identity, tree)
}


export async function ensureAgentCardFile(
  identity: EthagentIdentity,
  options: { fallback?: string | (() => Promise<string>) } = {},
): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  if (await exists(ref.agentCardPath)) return readAgentCardFile(identity)

  const legacyPath = path.join(ref.dir, 'skills.json')
  if (await exists(legacyPath)) {
    const legacyContent = await readOrDefault(legacyPath, '')
    if (legacyContent) {
      await atomicWriteText(ref.agentCardPath, ensureTrailingNewline(legacyContent), { mode: 0o644 })
    }
    await fs.rm(legacyPath, { force: true })
    if (await exists(ref.agentCardPath)) return readAgentCardFile(identity)
  }

  const fallback = await resolveAgentCardFallback(identity, options.fallback)
  await atomicWriteText(ref.agentCardPath, ensureTrailingNewline(fallback), { mode: 0o644 })
  return readAgentCardFile(identity)
}

export async function readAgentCardFile(identity: EthagentIdentity): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  return readOrDefault(ref.agentCardPath, defaultAgentCardJson(identity))
}

export async function writeAgentCardFile(identity: EthagentIdentity, content: string): Promise<ContinuityVaultRef> {
  const ref = await ensureContinuityVault(identity)
  await atomicWriteText(ref.agentCardPath, ensureTrailingNewline(content), { mode: 0o644 })
  return ref
}

async function resolveAgentCardFallback(
  identity: EthagentIdentity,
  fallback: string | (() => Promise<string>) | undefined,
): Promise<string> {
  if (typeof fallback === 'string') return fallback
  if (fallback) {
    try {
      return await fallback()
    } catch {
      return defaultAgentCardJson(identity)
    }
  }
  return defaultAgentCardJson(identity)
}
