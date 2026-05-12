import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../ui/theme.js'
import { inferLanguageFromPath, SyntaxLine } from './SyntaxText.js'

const EMPTY_DIFF_LINE = ' '

type DiffLineTone = 'added' | 'removed' | 'added-header' | 'removed-header' | 'hunk' | 'context' | 'marker'

type DiffLineStyle = {
  tone: DiffLineTone
  color: string
  backgroundColor?: string
}

type NumberedDiffLine = {
  line: string
  oldLine?: number
  newLine?: number
}

export function diffLineColor(line: string): string {
  return diffLineStyle(line).color
}

export function diffLineStyle(line: string): DiffLineStyle {
  if (line.startsWith('+++')) return { tone: 'added-header', color: theme.diffAdded }
  if (line.startsWith('---')) return { tone: 'removed-header', color: theme.diffRemoved }
  if (line.startsWith('+')) {
    return { tone: 'added', color: theme.text, backgroundColor: theme.diffAddedBackground }
  }
  if (line.startsWith('-')) {
    return { tone: 'removed', color: theme.text, backgroundColor: theme.diffRemovedBackground }
  }
  if (line.startsWith('@@')) return { tone: 'hunk', color: theme.accentPeriwinkle }
  if (line.startsWith('...')) return { tone: 'marker', color: theme.dim }
  return { tone: 'context', color: theme.textSubtle }
}

export const DiffView: React.FC<{ diff: string }> = ({ diff }) => (
  <DiffLines lines={visibleDiffLines(numberDiffLines(diff))} language={inferDiffLanguage(diff)} />
)

const DiffLines: React.FC<{ lines: NumberedDiffLine[]; language: string | null }> = ({ lines, language }) => {
  const width = lineNumberWidth(lines)
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <DiffLine
          key={index}
          line={line.line}
          oldLine={line.oldLine}
          newLine={line.newLine}
          width={width}
          language={language}
        />
      ))}
    </Box>
  )
}

const DiffLine: React.FC<{
  line: string
  oldLine?: number
  newLine?: number
  width: number
  language: string | null
}> = ({
  line,
  oldLine,
  newLine,
  width,
  language,
}) => {
  const style = diffLineStyle(line)
  const number = renderLineNumber(displayLineNumber(oldLine, newLine, style.tone), width)
  if (line.length === 0) {
    return <Text color={style.color}>{EMPTY_DIFF_LINE}</Text>
  }

  if (style.tone === 'added' || style.tone === 'removed') {
    const prefixColor = style.tone === 'added' ? theme.diffAdded : theme.diffRemoved
    return (
      <Box width="100%" backgroundColor={style.backgroundColor}>
        <Text>
          {number}
          <Text color={prefixColor}>{line.slice(0, 1)} </Text>
          <SyntaxLine line={line.slice(1)} lang={language} fallbackColor={style.color} />
        </Text>
      </Box>
    )
  }

  if (style.tone === 'context' && line.startsWith(' ')) {
    return (
      <Text color={style.color}>
        {number}
        <Text>{' '}</Text>
        <SyntaxLine line={line.slice(1)} lang={language} fallbackColor={style.color} />
      </Text>
    )
  }

  return <Text color={style.color}>{line}</Text>
}

function lineNumberWidth(lines: NumberedDiffLine[]): number {
  return Math.max(
    2,
    ...lines.map(line => String(displayLineNumber(line.oldLine, line.newLine, diffLineStyle(line.line).tone) ?? '').length),
  )
}

function displayLineNumber(
  oldLine: number | undefined,
  newLine: number | undefined,
  tone: DiffLineTone,
): number | undefined {
  if (tone === 'removed') return oldLine
  return newLine ?? oldLine
}

function renderLineNumber(line: number | undefined, width: number): React.ReactNode {
  if (line === undefined) return null
  return <Text color={theme.dim}>{String(line).padStart(width, ' ')} </Text>
}

function visibleDiffLines(lines: NumberedDiffLine[]): NumberedDiffLine[] {
  return lines.filter(line => {
    const tone = diffLineStyle(line.line).tone
    return tone !== 'added-header' && tone !== 'removed-header' && tone !== 'hunk'
  })
}

function inferDiffLanguage(diff: string): string | null {
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+++ ') || line === '+++ /dev/null') continue
    return inferLanguageFromPath(line.slice(4).trim())
  }
  for (const line of diff.split('\n')) {
    if (!line.startsWith('--- ') || line === '--- /dev/null') continue
    return inferLanguageFromPath(line.slice(4).trim())
  }
  return null
}

export function numberDiffLines(diff: string): NumberedDiffLine[] {
  const out: NumberedDiffLine[] = []
  let oldLine: number | undefined
  let newLine: number | undefined

  for (const line of diff.split('\n')) {
    const hunk = parseHunkHeader(line)
    if (hunk) {
      oldLine = hunk.oldStart
      newLine = hunk.newStart
      out.push({ line })
      continue
    }

    if (oldLine !== undefined && newLine !== undefined) {
      if (line.startsWith(' ')) {
        out.push({ line, oldLine, newLine })
        oldLine += 1
        newLine += 1
        continue
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        out.push({ line, oldLine })
        oldLine += 1
        continue
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        out.push({ line, newLine })
        newLine += 1
        continue
      }
    }

    out.push({ line })
  }

  return out
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (!match) return null
  return {
    oldStart: Number(match[1]),
    newStart: Number(match[2]),
  }
}
