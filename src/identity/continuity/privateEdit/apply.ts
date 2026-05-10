import type { EthagentIdentity } from '../../../storage/config.js'
import { applyRequestedEdit } from '../../../tools/editUtils.js'
import { defaultContinuityFiles, type PrivateContinuityFile } from '../storage.js'
import type { PrivateContinuityEditInput } from './types.js'

export function applyPrivateContinuityEdit(input: PrivateContinuityEditInput, before: string, identity: EthagentIdentity) {
  if (input.replaceWholeFile) {
    throw new Error('Private continuity files must be edited in place; whole-file replacement is disabled')
  }
  if (input.appendToSection || input.appendText) {
    if (!input.appendToSection?.trim()) throw new Error('Field appendToSection is required for append edits')
    if (!input.appendText?.trim()) throw new Error('Field appendText is required for append edits')
    if (input.oldText || input.newText !== undefined) {
      throw new Error('Use either appendToSection+appendText or oldText+newText, not both')
    }
    return appendToMarkdownSection(identity, input.file, before, input.appendToSection, input.appendText)
  }
  if (!input.oldText?.trim()) {
    throw new Error('Field oldText is required; private continuity edits must patch existing scaffold text')
  }
  if (input.newText === undefined) {
    throw new Error('Field newText is required for targeted private continuity edits')
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
  const normalizedAppend = ensureTrailingNewline(appendText.trim())
  const after = ensureTrailingNewline(suffix
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
  if (!before) return ensureTrailingNewline(after ? `${block}\n\n${after}` : block)
  return ensureTrailingNewline(after ? `${before}\n\n${block}\n\n${after}` : `${before}\n\n${block}`)
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

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function previewText(text: string, max = 700): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
