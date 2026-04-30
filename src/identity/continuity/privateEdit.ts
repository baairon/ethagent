import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { applyRequestedEdit } from '../../tools/editUtils.js'
import {
  continuityVaultRef,
  defaultContinuityFiles,
  ensureContinuityVault,
  type PrivateContinuityFile,
} from './storage.js'

export type PrivateContinuityEditInput = {
  file: PrivateContinuityFile
  oldText?: string
  newText?: string
  appendToSection?: string
  appendText?: string
  replaceAll?: boolean
  replaceWholeFile?: boolean
}

export type PreparedPrivateContinuityEdit = {
  identity: EthagentIdentity
  file: PrivateContinuityFile
  fullPath: string
  relativePath: string
  directoryPath: string
  existedBefore: boolean
  previousContent: string
  before: string
  after: string
  previewBefore: string
  previewAfter: string
  changeSummary: string
  diff: string
}

export async function preparePrivateContinuityEdit(
  input: PrivateContinuityEditInput,
  config: EthagentConfig | undefined,
): Promise<PreparedPrivateContinuityEdit> {
  const identity = config?.identity
  if (!identity) {
    throw new Error('no active identity; create or load an identity before proposing private continuity edits')
  }

  const fullPath = privateContinuityPath(identity, input.file)
  const existing = await readPrivateContinuityFile(identity, input.file, fullPath)
  const applied = applyPrivateContinuityEdit(input, existing.content, identity)

  return {
    identity,
    file: input.file,
    fullPath,
    relativePath: `identity-vault/${input.file}`,
    directoryPath: path.dirname(fullPath),
    existedBefore: existing.existedBefore,
    previousContent: existing.existedBefore ? existing.content : '',
    before: existing.content,
    after: applied.after,
    previewBefore: applied.previewBefore,
    previewAfter: applied.previewAfter,
    changeSummary: applied.summary,
    diff: renderPrivateContinuityDiff(input.file, applied.before, applied.after),
  }
}

function applyPrivateContinuityEdit(input: PrivateContinuityEditInput, before: string, identity: EthagentIdentity) {
  if (input.replaceWholeFile) {
    throw new Error('private continuity files must be edited in place; whole-file replacement is disabled')
  }
  if (input.appendToSection || input.appendText) {
    if (!input.appendToSection?.trim()) throw new Error('appendToSection is required for append edits')
    if (!input.appendText?.trim()) throw new Error('appendText is required for append edits')
    if (input.oldText || input.newText !== undefined) {
      throw new Error('use either appendToSection+appendText or oldText+newText, not both')
    }
    return appendToMarkdownSection(identity, input.file, before, input.appendToSection, input.appendText)
  }
  if (!input.oldText?.trim()) {
    throw new Error('oldText is required; private continuity edits must patch existing scaffold text')
  }
  if (input.newText === undefined) {
    throw new Error('newText is required for targeted private continuity edits')
  }
  return applyRequestedEdit(
    input.file,
    before,
    input.oldText,
    input.newText,
    input.replaceAll ?? false,
    false,
  )
}

export async function writePreparedPrivateContinuityEdit(edit: PreparedPrivateContinuityEdit): Promise<void> {
  await ensureContinuityVault(edit.identity)
  await atomicWriteText(edit.fullPath, normalizeMarkdown(edit.after), { mode: 0o600 })
}

function privateContinuityPath(identity: EthagentIdentity, file: PrivateContinuityFile): string {
  const ref = continuityVaultRef(identity)
  return file === 'SOUL.md' ? ref.soulPath : ref.memoryPath
}

async function readPrivateContinuityFile(
  identity: EthagentIdentity,
  file: PrivateContinuityFile,
  fullPath: string,
): Promise<{ content: string; existedBefore: boolean }> {
  try {
    return { content: await fs.readFile(fullPath, 'utf8'), existedBefore: true }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: defaultContinuityFiles(identity)[file], existedBefore: false }
    }
    throw err
  }
}

function renderPrivateContinuityDiff(file: PrivateContinuityFile, before: string, after: string): string {
  if (before === after) return '(no changes)'
  const changedLines = changedMarkdownLines(before, after)
  const lines = [
    `--- ${file}`,
    `+++ ${file}`,
    ...(changedLines.length > 0 ? changedLines : ['(only whitespace or line ending changes)']),
  ]
  const diff = lines.join('\n')
  return diff.length <= 2400 ? diff : `${diff.slice(0, 2397)}...`
}

function changedMarkdownLines(before: string, after: string): string[] {
  const beforeLines = markdownLines(before)
  const afterLines = markdownLines(after)
  const lengths = lcsLengths(beforeLines, afterLines)
  const changed: string[] = []
  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      beforeIndex += 1
      afterIndex += 1
      continue
    }

    const deleteScore = lengths[beforeIndex + 1]![afterIndex]!
    const insertScore = lengths[beforeIndex]![afterIndex + 1]!
    const deleteRevealsMatch = beforeLines[beforeIndex + 1] === afterLines[afterIndex]
    const insertRevealsMatch = beforeLines[beforeIndex] === afterLines[afterIndex + 1]

    if (insertRevealsMatch && insertScore >= deleteScore) {
      changed.push(`+${afterLines[afterIndex]}`)
      afterIndex += 1
    } else if (deleteRevealsMatch && deleteScore >= insertScore) {
      changed.push(`-${beforeLines[beforeIndex]}`)
      beforeIndex += 1
    } else if (deleteScore >= insertScore) {
      changed.push(`-${beforeLines[beforeIndex]}`)
      beforeIndex += 1
    } else {
      changed.push(`+${afterLines[afterIndex]}`)
      afterIndex += 1
    }
  }

  while (beforeIndex < beforeLines.length) {
    changed.push(`-${beforeLines[beforeIndex]}`)
    beforeIndex += 1
  }
  while (afterIndex < afterLines.length) {
    changed.push(`+${afterLines[afterIndex]}`)
    afterIndex += 1
  }

  return changed
}

function lcsLengths(beforeLines: string[], afterLines: string[]): number[][] {
  const lengths = Array.from(
    { length: beforeLines.length + 1 },
    () => Array<number>(afterLines.length + 1).fill(0),
  )

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(lengths[beforeIndex + 1]![afterIndex]!, lengths[beforeIndex]![afterIndex + 1]!)
    }
  }

  return lengths
}

function appendToMarkdownSection(
  identity: EthagentIdentity,
  file: PrivateContinuityFile,
  before: string,
  section: string,
  appendText: string,
) {
  const heading = normalizeSectionHeading(section)
  let working = before
  let repairedMissingSection = false
  let lines = working.split(/\r?\n/)
  let bounds = findMarkdownSectionBounds(lines, heading)
  if (!bounds) {
    const repaired = insertDefaultScaffoldSection(identity, file, before, heading)
    if (!repaired) {
      throw new Error(`section "${section}" was not found in ${file}; target an existing scaffold section`)
    }
    working = repaired
    repairedMissingSection = true
    lines = working.split(/\r?\n/)
    bounds = findMarkdownSectionBounds(lines, heading)
  }
  if (!bounds) {
    throw new Error(`section "${section}" was not found in ${file}; target an existing scaffold section`)
  }
  const { start, end: insertAt } = bounds
  const prefix = lines.slice(0, insertAt).join('\n').replace(/\s+$/g, '')
  const suffix = insertAt >= lines.length ? '' : lines.slice(insertAt).join('\n').replace(/^\s+/g, '')
  const normalizedAppend = normalizeMarkdown(appendText.trim())
  const after = normalizeMarkdown(suffix
    ? `${prefix}\n${normalizedAppend}\n${suffix}`
    : `${prefix}\n${normalizedAppend}`)
  const afterLines = after.split(/\r?\n/)
  const afterBounds = findMarkdownSectionBounds(afterLines, heading)
  return {
    before,
    after,
    summary: repairedMissingSection
      ? `repair ${heading} section and append to ${heading} in ${file}`
      : `append to ${heading} in ${file}`,
    previewBefore: repairedMissingSection
      ? `section "${heading}" was missing in ${file}; approval will add the scaffold section before appending.`
      : previewText(sectionPreview(lines, start, insertAt)),
    previewAfter: previewText(afterBounds
      ? sectionPreview(afterLines, afterBounds.start, afterBounds.end)
      : normalizedAppend),
  }
}

function insertDefaultScaffoldSection(
  identity: EthagentIdentity,
  file: PrivateContinuityFile,
  before: string,
  heading: string,
): string | null {
  const defaults = defaultContinuityFiles(identity)[file]
  const defaultSection = extractMarkdownSection(defaults, heading)
  if (!defaultSection) return null

  const defaultHeadings = markdownSectionHeadings(defaults)
  const targetIndex = defaultHeadings.indexOf(heading)
  if (targetIndex === -1) return null

  const lines = before.split(/\r?\n/)
  const followingHeadings = new Set(defaultHeadings.slice(targetIndex + 1))
  const followingIndex = lines.findIndex(line => followingHeadings.has(normalizeSectionHeading(line)))
  if (followingIndex !== -1) {
    return insertSectionAtLine(before, followingIndex, defaultSection)
  }

  const previousHeadings = new Set(defaultHeadings.slice(0, targetIndex))
  let insertAfterPrevious: number | null = null
  for (let index = 0; index < lines.length; index += 1) {
    if (!previousHeadings.has(normalizeSectionHeading(lines[index] ?? ''))) continue
    const bounds = findMarkdownSectionBounds(lines, normalizeSectionHeading(lines[index] ?? ''))
    if (bounds && bounds.end > (insertAfterPrevious ?? -1)) insertAfterPrevious = bounds.end
  }
  if (insertAfterPrevious !== null) {
    return insertSectionAtLine(before, insertAfterPrevious, defaultSection)
  }

  const firstHeading = lines.findIndex(line => /^#\s+/.test(line.trim()))
  return insertSectionAtLine(before, firstHeading === -1 ? 0 : firstHeading + 1, defaultSection)
}

function insertSectionAtLine(markdown: string, lineIndex: number, section: string): string {
  const lines = markdown.split(/\r?\n/)
  const before = lines.slice(0, lineIndex).join('\n').replace(/\s+$/g, '')
  const after = lines.slice(lineIndex).join('\n').replace(/^\s+/g, '')
  const block = section.trim()
  if (!before) return normalizeMarkdown(after ? `${block}\n\n${after}` : block)
  return normalizeMarkdown(after ? `${before}\n\n${block}\n\n${after}` : `${before}\n\n${block}`)
}

function extractMarkdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/)
  const bounds = findMarkdownSectionBounds(lines, heading)
  if (!bounds) return null
  return lines.slice(bounds.start, bounds.end).join('\n').trim()
}

function markdownSectionHeadings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter(line => /^##\s+/.test(line.trim()))
    .map(normalizeSectionHeading)
}

function findMarkdownSectionBounds(lines: string[], heading: string): { start: number; end: number } | null {
  const start = lines.findIndex(line => normalizeSectionHeading(line) === heading && /^#{1,6}\s+/.test(line.trim()))
  if (start === -1) return null
  const nextSection = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()))
  return { start, end: nextSection === -1 ? lines.length : nextSection }
}

function normalizeSectionHeading(value: string): string {
  return value.trim().replace(/^#+\s*/, '').trim()
}

function sectionPreview(lines: string[], start: number, end: number): string {
  return lines.slice(start, Math.min(end, start + 8)).join('\n')
}

function markdownLines(value: string): string[] {
  const lines = value.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function normalizeMarkdown(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function previewText(text: string, max = 700): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
