import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir, type EthagentIdentity } from '../../storage/config.js'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import type { ContinuityAgentSnapshot, ContinuityFiles } from './envelope.js'
import { defaultPublicSkillsProfile, renderPublicSkillsMarkdown } from './publicSkills.js'

export const PRIVATE_CONTINUITY_FILES = ['SOUL.md', 'MEMORY.md'] as const
export type PrivateContinuityFile = (typeof PRIVATE_CONTINUITY_FILES)[number]

export type ContinuityVaultRef = {
  dir: string
  soulPath: string
  memoryPath: string
  publicSkillsPath: string
}

export type IdentityMarkdownScaffold = ContinuityFiles & {
  'SKILLS.md': string
}

export function continuityVaultRef(identity: Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'agentId' | 'address'>): ContinuityVaultRef {
  const dir = path.join(getConfigDir(), 'continuity', continuityVaultId(identity))
  return {
    dir,
    soulPath: path.join(dir, 'SOUL.md'),
    memoryPath: path.join(dir, 'MEMORY.md'),
    publicSkillsPath: path.join(dir, 'SKILLS.md'),
  }
}

export async function ensureContinuityVault(identity: EthagentIdentity): Promise<ContinuityVaultRef> {
  const ref = continuityVaultRef(identity)
  await fs.mkdir(ref.dir, { recursive: true, mode: 0o700 })
  return ref
}

export async function ensureContinuityFiles(identity: EthagentIdentity): Promise<ContinuityFiles> {
  const ref = await ensureContinuityVault(identity)
  const defaults = defaultContinuityFiles(identity)
  await writeMissingPrivateFile(ref.soulPath, defaults['SOUL.md'])
  await writeMissingPrivateFile(ref.memoryPath, defaults['MEMORY.md'])
  return readContinuityFiles(identity)
}

export async function readContinuityFiles(identity: EthagentIdentity): Promise<ContinuityFiles> {
  const ref = await ensureContinuityVault(identity)
  const defaults = defaultContinuityFiles(identity)
  return {
    'SOUL.md': await readOrDefault(ref.soulPath, defaults['SOUL.md']),
    'MEMORY.md': await readOrDefault(ref.memoryPath, defaults['MEMORY.md']),
  }
}

export async function writeContinuityFiles(identity: EthagentIdentity, files: ContinuityFiles): Promise<ContinuityVaultRef> {
  const ref = await ensureContinuityVault(identity)
  await atomicWriteText(ref.soulPath, normalizeMarkdown(files['SOUL.md']), { mode: 0o600 })
  await atomicWriteText(ref.memoryPath, normalizeMarkdown(files['MEMORY.md']), { mode: 0o600 })
  return ref
}

export async function ensureIdentityMarkdownScaffold(
  identity: EthagentIdentity,
  options: { publicSkillsFallback?: string | (() => Promise<string>) } = {},
): Promise<IdentityMarkdownScaffold> {
  const privateFiles = await ensureContinuityFiles(identity)
  const publicSkills = await ensurePublicSkillsFile(identity, { fallback: options.publicSkillsFallback })
  return {
    ...privateFiles,
    'SKILLS.md': publicSkills,
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
  await writePublicSkillsFile(identity, files['SKILLS.md'])
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
  const publicDefault = defaultPublicSkillsMarkdown(identity)
  return {
    'SOUL.md': syncGeneratedMarkdown(privateFiles['SOUL.md'], privateDefaults['SOUL.md'], [
      { marker: 'identity', legacyHeading: 'Identity' },
    ]),
    'MEMORY.md': syncGeneratedMarkdown(privateFiles['MEMORY.md'], privateDefaults['MEMORY.md'], [
      { marker: 'identity' },
    ]),
    'SKILLS.md': syncGeneratedMarkdown(publicSkills, publicDefault, [
      { marker: 'public-profile' },
    ]),
  }
}

export async function ensurePublicSkillsFile(
  identity: EthagentIdentity,
  options: { fallback?: string | (() => Promise<string>) } = {},
): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  if (await exists(ref.publicSkillsPath)) return readPublicSkillsFile(identity)
  const fallback = await resolvePublicSkillsFallback(identity, options.fallback)
  await atomicWriteText(ref.publicSkillsPath, normalizeMarkdown(fallback), { mode: 0o644 })
  return readPublicSkillsFile(identity)
}

export async function readPublicSkillsFile(identity: EthagentIdentity): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  return readOrDefault(ref.publicSkillsPath, defaultPublicSkillsMarkdown(identity))
}

export async function writePublicSkillsFile(identity: EthagentIdentity, content: string): Promise<ContinuityVaultRef> {
  const ref = await ensureContinuityVault(identity)
  await atomicWriteText(ref.publicSkillsPath, normalizeMarkdown(content), { mode: 0o644 })
  return ref
}

export async function continuityVaultStatus(identity: EthagentIdentity): Promise<{ ready: boolean; files: ContinuityVaultRef }> {
  const ref = continuityVaultRef(identity)
  const [soul, memory] = await Promise.all([exists(ref.soulPath), exists(ref.memoryPath)])
  return { ready: soul && memory, files: ref }
}

export function continuityAgentSnapshot(identity: EthagentIdentity): ContinuityAgentSnapshot {
  const state = identity.state ?? {}
  return {
    ...(identity.chainId ? { chainId: identity.chainId } : {}),
    ...(identity.identityRegistryAddress ? { identityRegistryAddress: identity.identityRegistryAddress } : {}),
    ...(identity.agentId ? { agentId: identity.agentId } : {}),
    ...(identity.agentUri ? { agentUri: identity.agentUri } : {}),
    ...(identity.metadataCid ? { metadataCid: identity.metadataCid } : {}),
    ...(typeof state.name === 'string' ? { name: state.name } : {}),
    ...(typeof state.description === 'string' ? { description: state.description } : {}),
  }
}

export function defaultContinuityFiles(identity: EthagentIdentity, now = new Date()): ContinuityFiles {
  const owner = identity.ownerAddress ?? identity.address
  const state = identity.state ?? {}
  const name = typeof state.name === 'string' && state.name.trim()
    ? state.name.trim()
    : identity.agentId ? `agent #${identity.agentId}` : 'ethagent'
  const description = typeof state.description === 'string' ? state.description.trim() : ''
  const created = now.toISOString().slice(0, 10)
  const identityBlock = renderPrivateIdentityBlock({
    name,
    owner,
    token: identity.agentId ? `#${identity.agentId}` : 'pending registration',
    chainId: identity.chainId ? identity.chainId.toString() : 'unknown',
    registry: identity.identityRegistryAddress ?? 'unknown',
    description: description || 'not set',
  })
  return {
    'SOUL.md': [
      `# ${name} Soul`,
      '',
      identityBlock,
      '',
      '## Persona',
      '',
      '- Role: describe the agent identity, voice, and collaboration style here.',
      '- Operating principles: keep durable values and decision preferences here.',
      '- Boundaries: record private limits or owner-approved constraints here.',
      '',
      '## Private Instructions',
      '',
      '- Keep private continuity, persona, and owner-specific standing instructions in this file.',
      '- Do not publish this file directly; use encrypted snapshot backup from Identity Hub.',
      '- Public capabilities belong in SKILLS.md.',
      '',
      '## Maintenance Rules',
      '',
      '- Keep the generated Agent Identity block intact; edit owner-authored sections below it.',
      '- Prefer durable guidance over session-specific notes.',
      '- Move factual project memory to MEMORY.md when it is not persona or instruction material.',
      '',
      '## Change Notes',
      '',
      '- Add dated notes when the persona or long-lived private guidance changes.',
      '',
      `Created: ${created}`,
    ].join('\n') + '\n',
    'MEMORY.md': [
      `# ${name} Memory`,
      '',
      identityBlock,
      '',
      '## Durable User Preferences',
      '',
      '- Add long-lived owner preferences that should survive across sessions.',
      '',
      '## Project Context',
      '',
      '- Add stable project facts, repo conventions, and active workstreams.',
      '',
      '## Decisions and Rationale',
      '',
      '- Record important decisions and why they were made.',
      '',
      '## Facts to Revalidate',
      '',
      '- Add time-sensitive facts that should be checked before reuse.',
      '',
      '## Maintenance Rules',
      '',
      '- Prefer stable facts, preferences, and decisions over chat transcripts.',
      '- Add dates or source context when a note may become stale.',
      '- Remove or rewrite stale memory instead of accumulating contradictions.',
      '',
      '## Boundaries',
      '',
      '- Do not store secrets unless the user explicitly asks for it.',
      '- Do not store raw wallet signatures or private keys.',
      '- Keep public capabilities in SKILLS.md.',
      '',
      `Created: ${created}`,
    ].join('\n') + '\n',
  }
}

export function defaultPublicSkillsMarkdown(identity: EthagentIdentity): string {
  return renderPublicSkillsMarkdown(defaultPublicSkillsProfile(identity))
}

function continuityVaultId(identity: Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'agentId' | 'address'>): string {
  const chain = identity.chainId?.toString() ?? 'unknown-chain'
  const registry = sanitizePathPart(identity.identityRegistryAddress ?? 'unknown-registry')
  const token = sanitizePathPart(identity.agentId ?? identity.address)
  return `${chain}-${registry}-${token}`
}

function sanitizePathPart(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '').replace(/[^a-z0-9._-]+/g, '-').slice(0, 120) || 'unknown'
}

async function writeMissingPrivateFile(file: string, content: string): Promise<void> {
  if (await exists(file)) return
  await atomicWriteText(file, normalizeMarkdown(content), { mode: 0o600 })
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
      return defaultPublicSkillsMarkdown(identity)
    }
  }
  return defaultPublicSkillsMarkdown(identity)
}

async function readOrDefault(file: string, fallback: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function normalizeMarkdown(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

type SyncBlock = {
  marker: string
  legacyHeading?: string
}

function renderPrivateIdentityBlock(args: {
  name: string
  owner: string
  token: string
  chainId: string
  registry: string
  description: string
}): string {
  return [
    '<!-- ethagent:identity:start -->',
    '## Agent Identity',
    `- Agent name: ${args.name}`,
    `- Owner wallet: ${args.owner}`,
    `- ERC-8004 token: ${args.token}`,
    `- Chain ID: ${args.chainId}`,
    `- Registry: ${args.registry}`,
    `- Public description: ${args.description}`,
    '- Visibility: private local working file; encrypted before IPFS backup.',
    '<!-- ethagent:identity:end -->',
  ].join('\n')
}

function syncGeneratedMarkdown(existing: string, fresh: string, blocks: SyncBlock[]): string {
  let next = replaceFirstHeading(existing, firstHeading(fresh))
  for (const block of blocks) {
    next = replaceOrInsertMarkedBlock(next, fresh, block)
  }
  return normalizeMarkdown(next)
}

function firstHeading(markdown: string): string {
  return markdown.split(/\r?\n/).find(line => line.startsWith('# ')) ?? ''
}

function replaceFirstHeading(markdown: string, heading: string): string {
  if (!heading) return markdown
  const lines = markdown.split(/\r?\n/)
  const index = lines.findIndex(line => line.startsWith('# '))
  if (index === -1) return `${heading}\n\n${markdown.trimStart()}`
  lines[index] = heading
  return lines.join('\n')
}

function replaceOrInsertMarkedBlock(markdown: string, fresh: string, block: SyncBlock): string {
  const freshBlock = extractMarkedBlock(fresh, block.marker)
  if (!freshBlock) return markdown
  const replaced = replaceMarkedBlock(markdown, block.marker, freshBlock)
  if (replaced) return replaced
  if (block.legacyHeading) {
    const replacedLegacy = replaceMarkdownSection(markdown, block.legacyHeading, freshBlock)
    if (replacedLegacy) return replacedLegacy
  }
  return insertAfterFirstHeading(markdown, freshBlock)
}

function extractMarkedBlock(markdown: string, marker: string): string | null {
  const start = `<!-- ethagent:${marker}:start -->`
  const end = `<!-- ethagent:${marker}:end -->`
  const startIndex = markdown.indexOf(start)
  const endIndex = markdown.indexOf(end, startIndex + start.length)
  if (startIndex === -1 || endIndex === -1) return null
  return markdown.slice(startIndex, endIndex + end.length).trim()
}

function replaceMarkedBlock(markdown: string, marker: string, replacement: string): string | null {
  const start = `<!-- ethagent:${marker}:start -->`
  const end = `<!-- ethagent:${marker}:end -->`
  const startIndex = markdown.indexOf(start)
  const endIndex = markdown.indexOf(end, startIndex + start.length)
  if (startIndex === -1 || endIndex === -1) return null
  return `${markdown.slice(0, startIndex)}${replacement}${markdown.slice(endIndex + end.length)}`
}

function replaceMarkdownSection(markdown: string, heading: string, replacement: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  const before = lines.slice(0, start)
  const after = end === -1 ? [] : lines.slice(end)
  return [...before, replacement, '', ...after].join('\n')
}

function insertAfterFirstHeading(markdown: string, block: string): string {
  const lines = markdown.split(/\r?\n/)
  const headingIndex = lines.findIndex(line => line.startsWith('# '))
  if (headingIndex === -1) return `${block}\n\n${markdown.trimStart()}`
  const before = lines.slice(0, headingIndex + 1)
  const after = lines.slice(headingIndex + 1)
  return [...before, '', block, '', ...after].join('\n')
}
