import type { PrivateContinuityFile } from '../storage.js'

export function renderPrivateContinuityDiff(file: PrivateContinuityFile, before: string, after: string): string {
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

function markdownLines(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, '\n')
  return normalized.split('\n')
}
