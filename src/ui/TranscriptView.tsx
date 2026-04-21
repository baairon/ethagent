import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { MessageList, type MessageRow } from './MessageList.js'
import { theme } from './theme.js'

type TranscriptViewProps = {
  rows: MessageRow[]
  active?: boolean
  bottomVariant?: 'prompt' | 'overlay'
}

const OVERSCAN_LINES = 10

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  rows,
  active = true,
  bottomVariant = 'prompt',
}) => {
  const { stdout } = useStdout()
  const viewportLines = clamp(
    (stdout?.rows ?? 34) - (bottomVariant === 'overlay' ? 22 : 14),
    8,
    32,
  )
  const contentWidth = clamp((stdout?.columns ?? 100) - 6, 28, 160)
  const rowHeights = useMemo(
    () => rows.map(row => estimateRowHeight(row, contentWidth)),
    [rows, contentWidth],
  )
  const lineOffsets = useMemo(() => {
    const out = new Array<number>(rows.length + 1).fill(0)
    for (let i = 0; i < rows.length; i += 1) {
      out[i + 1] = out[i]! + (rowHeights[i] ?? 1)
    }
    return out
  }, [rowHeights, rows.length])
  const totalLines = lineOffsets.at(-1) ?? 0
  const maxScrollTop = Math.max(0, totalLines - viewportLines)
  const [scrollTopLine, setScrollTopLine] = useState(() => maxScrollTop)
  const [followTail, setFollowTail] = useState(true)

  useEffect(() => {
    if (followTail) {
      setScrollTopLine(maxScrollTop)
      return
    }
    setScrollTopLine(prev => Math.min(prev, maxScrollTop))
  }, [followTail, maxScrollTop])

  useInput((_input, key) => {
    if (!active) return
    if (key.pageUp) {
      setFollowTail(false)
      setScrollTopLine(prev => Math.max(0, prev - Math.max(6, viewportLines - 2)))
      return
    }
    if (key.pageDown) {
      setScrollTopLine(prev => {
        const next = Math.min(maxScrollTop, prev + Math.max(6, viewportLines - 2))
        setFollowTail(next >= maxScrollTop)
        return next
      })
      return
    }
    if (key.home) {
      setFollowTail(false)
      setScrollTopLine(0)
      return
    }
    if (key.end) {
      setFollowTail(true)
      setScrollTopLine(maxScrollTop)
    }
  }, { isActive: active })

  const startIndex = useMemo(
    () => Math.max(0, findRowIndexAtLine(lineOffsets, Math.max(0, scrollTopLine - OVERSCAN_LINES))),
    [lineOffsets, scrollTopLine],
  )
  const endIndex = useMemo(
    () => Math.min(rows.length, findRowIndexAtLine(lineOffsets, scrollTopLine + viewportLines + OVERSCAN_LINES) + 1),
    [lineOffsets, rows.length, scrollTopLine, viewportLines],
  )
  const visibleRows = useMemo(() => rows.slice(startIndex, endIndex), [endIndex, rows, startIndex])
  const hiddenAbove = scrollTopLine
  const hiddenBelow = Math.max(0, totalLines - (scrollTopLine + viewportLines))

  return (
    <Box flexDirection="column">
      {(hiddenAbove > 0 || hiddenBelow > 0) ? (
        <Box marginBottom={1}>
          <Text color={theme.dim}>
            {hiddenAbove > 0 ? `${hiddenAbove} line${hiddenAbove === 1 ? '' : 's'} above` : 'live tail'}
            <Text color={theme.border}> - </Text>
            <Text color={followTail ? theme.accentMint : theme.textSubtle}>
              {followTail ? 'following latest output' : `${hiddenBelow} line${hiddenBelow === 1 ? '' : 's'} below`}
            </Text>
            <Text color={theme.border}> - </Text>
            <Text color={theme.dim}>{followTail ? 'PgUp/PgDn scroll, Home/End jump' : 'manual scroll locked - End jumps to latest'}</Text>
          </Text>
        </Box>
      ) : null}
      <MessageList rows={visibleRows} />
    </Box>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function estimateRowHeight(row: MessageRow, width: number): number {
  const gap = 1

  if (row.role === 'user') return gap + estimateWrappedTextRows(row.content, width)
  if (row.role === 'assistant') return gap + estimateWrappedTextRows(`${row.content}${row.liveTail ?? ''}`, width)
  if (row.role === 'thinking') return gap + estimateWrappedTextRows(`${row.content}${row.liveTail ?? ''}`, width)
  if (row.role === 'note') return gap + estimateWrappedTextRows(row.content, width)
  if (row.role === 'progress') return 4
  if (row.role === 'tool_use') return 4 + estimateWrappedTextRows(`${row.summary}\n${row.input ?? ''}`, width)
  if (row.role === 'tool_result') return 4 + estimateWrappedTextRows(`${row.summary}\n${row.content}`, width)
  return gap + 1
}

function estimateWrappedTextRows(text: string, width: number): number {
  const lines = text.split('\n')
  let count = 0
  for (const line of lines) {
    const chars = line.length === 0 ? 1 : line.length
    count += Math.max(1, Math.ceil(chars / Math.max(1, width)))
  }
  return count
}

function findRowIndexAtLine(offsets: number[], line: number): number {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if ((offsets[mid] ?? 0) <= line) low = mid
    else high = mid - 1
  }
  return low
}
