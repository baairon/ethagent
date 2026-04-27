export type ToolClaimKind =
  | 'directory_change'
  | 'path_existence'
  | 'directory_listing'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'file_delete'
  | 'bash_run'

export type ToolEvidence = {
  name: string
  result?: {
    ok?: boolean
  }
}

const CLAIM_PATTERNS: Array<{ kind: ToolClaimKind; patterns: RegExp[] }> = [
  {
    kind: 'directory_change',
    patterns: [
      /\b(i am|i'm) now in (the )?.{1,80}\b(directory|folder)\b/,
      /\b(i have|i've|we have|we've) changed (the )?(current working )?(directory|folder)\b/,
      /\bcurrent working directory has been changed\b/,
      /\bchanged to .{1,100}\b(directory|folder)\b/,
    ],
  },
  {
    kind: 'path_existence',
    patterns: [
      /\b(directory|folder|file|path)\b.{0,100}\b(exists|does not exist|doesn't exist|not found|missing|is present)\b/,
      /\b(appears|seems|looks like)\b.{0,120}\b(does not exist|doesn't exist|not found|missing)\b/,
      /\b(i cannot|i can't|i do not|i don't)\s+(find|see|locate)\b.{0,100}\b(directory|folder|file|path)\b/,
      /\b(no|not any)\b.{0,80}\b(directory|folder|file|path)\b.{0,80}\b(found|exists|present)\b/,
    ],
  },
  {
    kind: 'directory_listing',
    patterns: [
      /\b(files and directories|files in this directory|directory listing|list of files|entries are|listed are)\b/,
      /\bhere'?s (the )?(list|directory listing|files)\b/,
    ],
  },
  {
    kind: 'file_read',
    patterns: [
      /\b(i read|i've read|read the file|file contains|contents of)\b/,
    ],
  },
  {
    kind: 'file_write',
    patterns: [
      /\b(created|wrote|written)\b.{0,100}\b(file|directory|folder|path|workspace|project|repo|repository)\b/,
    ],
  },
  {
    kind: 'file_edit',
    patterns: [
      /\b(updated|edited|modified|changed)\b.{0,100}\b(file|directory|folder|path|workspace|project|repo|repository)\b/,
    ],
  },
  {
    kind: 'file_delete',
    patterns: [
      /\b(deleted|removed)\b.{0,100}\b(file|directory|folder|path|workspace|project|repo|repository)\b/,
    ],
  },
  {
    kind: 'bash_run',
    patterns: [
      /\b(ran|executed)\b.{0,100}\b(command|script|test|npm|node|git|bash|shell)\b/,
    ],
  },
]

export function classifyToolStateClaims(text: string): ToolClaimKind[] {
  const lower = normalizeText(text)
  if (!lower) return []

  const out: ToolClaimKind[] = []
  for (const { kind, patterns } of CLAIM_PATTERNS) {
    if (patterns.some(pattern => pattern.test(lower))) out.push(kind)
  }
  return out
}

export function looksLikeToolStateClaim(text: string): boolean {
  return classifyToolStateClaims(text).length > 0
}

export function unsupportedToolStateClaims(
  text: string,
  evidence: ToolEvidence[],
): ToolClaimKind[] {
  return classifyToolStateClaims(text).filter(kind => !hasEvidenceForClaim(kind, evidence))
}

export function isUserCorrectionOfToolState(text: string): boolean {
  const lower = normalizeText(text)
  if (!lower) return false

  const correction =
    /\b(no|nah|wrong|incorrect|not true|you didn't|you didnt|you did not|u didn't|u didnt|u did not|didn't execute|didnt execute|did not execute|didn't run|didnt run|did not run|try again|retry|just try|it does exist|that exists|it is there|it's there|you are wrong|you're wrong)\b/
  const directMiss =
    /\b(you|u)\s+(didn't|didnt|did not)\b/
  const toolContext =
    /\b(tool|call|execute|run|cd|directory|folder|file|path|exist|exists|there|try|change|list|read)\b/

  return directMiss.test(lower) || (correction.test(lower) && toolContext.test(lower))
}

function hasEvidenceForClaim(kind: ToolClaimKind, evidence: ToolEvidence[]): boolean {
  switch (kind) {
    case 'directory_change':
      return hasSuccessfulTool(evidence, ['change_directory'])
    case 'path_existence':
      return hasAnyTool(evidence, ['list_directory', 'read_file', 'change_directory'])
    case 'directory_listing':
      return hasSuccessfulTool(evidence, ['list_directory'])
    case 'file_read':
      return hasSuccessfulTool(evidence, ['read_file'])
    case 'file_write':
      return hasSuccessfulTool(evidence, ['write_file'])
    case 'file_edit':
      return hasSuccessfulTool(evidence, ['edit_file'])
    case 'file_delete':
      return hasSuccessfulTool(evidence, ['delete_file'])
    case 'bash_run':
      return hasSuccessfulTool(evidence, ['run_bash'])
  }
}

function hasAnyTool(evidence: ToolEvidence[], names: string[]): boolean {
  return evidence.some(item => names.includes(item.name))
}

function hasSuccessfulTool(evidence: ToolEvidence[], names: string[]): boolean {
  return evidence.some(item => names.includes(item.name) && item.result?.ok === true)
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}
