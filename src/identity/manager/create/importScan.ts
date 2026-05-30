import fs from 'node:fs/promises'
import path from 'node:path'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles } from '../../continuity/envelope.js'
import { defaultContinuityFiles } from '../../continuity/storage.js'
import { extractOutsideManaged } from '../../../cli/syncAdapters/managedBlock.js'
import { BUILT_IN_ADAPTERS } from '../../../cli/syncAdapters/index.js'

export type ImportCandidate = {
  source: string
  raw: string
  contentLines: number
}

const MIN_SUBSTANTIVE_CHARS = 120
const MIN_CONTENT_LINES = 5

function stripIdentityBlocks(text: string): string {
  return text.replace(/<!--\s*ethagent:identity:start\s*-->[\s\S]*?<!--\s*ethagent:identity:end\s*-->/g, '')
}

function substantiveLines(text: string): string[] {
  return stripIdentityBlocks(text)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith('#'))
    .filter(line => !(line.startsWith('<!--') && line.endsWith('-->')))
}

const SCAFFOLD_LINES: Set<string> = (() => {
  const scaffold = defaultContinuityFiles({
    source: 'erc8004',
    address: '0x0000000000000000000000000000000000000000',
  } as EthagentIdentity)
  return new Set([
    ...substantiveLines(scaffold['SOUL.md']),
    ...substantiveLines(scaffold['MEMORY.md']),
  ])
})()

function localOnlyLines(text: string): string[] {
  return substantiveLines(text).filter(line => !SCAFFOLD_LINES.has(line))
}

export function isValuableImport(text: string): boolean {
  const lines = localOnlyLines(text)
  if (lines.length === 0) return false
  const chars = lines.join('').replace(/\s/g, '').length
  return chars >= MIN_SUBSTANTIVE_CHARS || lines.length >= MIN_CONTENT_LINES
}

export async function scanImportCandidates(): Promise<ImportCandidate[]> {
  const out: ImportCandidate[] = []
  for (const adapter of BUILT_IN_ADAPTERS) {
    if (!adapter.managedFilePaths) continue
    const detected = await adapter.detect().catch(() => false)
    if (!detected) continue
    const filePath = adapter.managedFilePaths()[0]
    if (!filePath) continue
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const outside = extractOutsideManaged(content)
    if (!isValuableImport(outside)) continue
    out.push({
      source: path.basename(filePath),
      raw: outside.trim(),
      contentLines: localOnlyLines(outside).length,
    })
  }
  return out
}

export function mergeImportedNotes(
  base: ContinuityFiles,
  candidates: ImportCandidate[],
  now = new Date(),
): ContinuityFiles {
  if (candidates.length === 0) return base
  const dateStr = now.toISOString().slice(0, 10)
  const sources = candidates.map(candidate => candidate.source).join(', ')
  const lines: string[] = [
    `## Imported from ${sources} (${dateStr})`,
    '',
    'Captured from your existing assistant notes at mint time. Reorganize into the sections above as you like.',
    '',
  ]
  for (const candidate of candidates) {
    if (candidates.length > 1) lines.push(`### ${candidate.source}`, '')
    lines.push(candidate.raw, '')
  }
  const importedSection = lines.join('\n').trim()
  const memory = `${base['MEMORY.md'].replace(/\n+$/, '')}\n\n${importedSection}\n`
  return { 'SOUL.md': base['SOUL.md'], 'MEMORY.md': memory }
}
