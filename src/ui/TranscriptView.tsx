import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useAppInput } from '../input/AppInputProvider.js'
import { MessageList, type MessageRow } from './MessageList.js'
import { theme } from './theme.js'
import {
  anchorForScrollTop,
  buildLineOffsets,
  clampLine,
  estimateMessageRowHeight,
  promptScrollTopForPageDown,
  promptScrollTopForPageUp,
  resolveScrollTopFromAnchor,
  selectRowsForScrollTop,
  type TranscriptWindowSelection,
  type TranscriptViewportState,
} from './transcriptViewport.js'

type TranscriptViewProps = {
  rows: MessageRow[]
  active?: boolean
  bottomVariant?: 'prompt' | 'overlay'
}

const PROMPT_RESERVED_LINES = 11
const OVERLAY_RESERVED_LINES = 16
const MIN_TRANSCRIPT_LINES = 6
const MAX_TRANSCRIPT_LINES = 120

export const TranscriptView: React.FC<TranscriptViewProps> = ({ rows, active = true, bottomVariant = 'prompt' }) => {
  const { stdout } = useStdout()
  const columns = stdout.columns ?? process.stdout.columns ?? 80
  const terminalRows = stdout.rows ?? process.stdout.rows ?? 24
  const reservedLines = bottomVariant === 'overlay' ? OVERLAY_RESERVED_LINES : PROMPT_RESERVED_LINES
  const maxLines = Math.min(
    MAX_TRANSCRIPT_LINES,
    Math.max(MIN_TRANSCRIPT_LINES, terminalRows - reservedLines),
  )
  const [viewportState, setViewportState] = useState<TranscriptViewportState>({
    scrollTopLine: 0,
    followTail: true,
    anchor: null,
  })
  const metrics = useMemo(() => {
    const heights = rows.map(row => Math.max(1, estimateMessageRowHeight(row, columns)))
    const offsets = buildLineOffsets(heights)
    const totalLines = offsets[offsets.length - 1] ?? 0
    return {
      rowIds: rows.map(row => row.id),
      offsets,
      maxScrollTop: Math.max(0, totalLines - maxLines),
    }
  }, [columns, maxLines, rows])
  const resolvedViewportState = useMemo(
    () => resolveViewportState(viewportState, metrics.rowIds, metrics.offsets, metrics.maxScrollTop),
    [metrics, viewportState],
  )
  const selection = useMemo(
    () => trimSelectionToFocusedTurn(
      selectRowsForScrollTop(
        rows,
        maxLines,
        resolvedViewportState.scrollTopLine,
        row => estimateMessageRowHeight(row, columns),
      ),
      rows,
      resolvedViewportState,
    ),
    [columns, maxLines, resolvedViewportState, rows],
  )

  useEffect(() => {
    setViewportState(prev => sameViewportState(prev, resolvedViewportState) ? prev : resolvedViewportState)
  }, [resolvedViewportState])

  useAppInput((_input, key) => {
    if (key.pageUp) {
      const target = promptScrollTopForPageUp(
        rows,
        metrics.offsets,
        resolvedViewportState.scrollTopLine,
        metrics.maxScrollTop,
        resolvedViewportState.followTail,
      )
      setViewportState(viewportForScrollTop(
        target,
        metrics.rowIds,
        metrics.offsets,
        metrics.maxScrollTop,
      ))
    } else if (key.pageDown) {
      const target = promptScrollTopForPageDown(
        rows,
        metrics.offsets,
        resolvedViewportState.scrollTopLine,
        metrics.maxScrollTop,
      )
      setViewportState(viewportForScrollTop(
        target,
        metrics.rowIds,
        metrics.offsets,
        metrics.maxScrollTop,
      ))
    }
  }, { isActive: active })

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text> </Text>
      </Box>
      {selection.hiddenBefore > 0 ? (
        <Text color={theme.dim}>
          {`  ${selection.hiddenBefore} earlier message${selection.hiddenBefore === 1 ? '' : 's'} above this view`}
        </Text>
      ) : null}
      <MessageList rows={selection.rows} />
      {selection.hiddenAfter > 0 ? (
        <Text color={theme.dim}>
          {`  ${selection.hiddenAfter} later message${selection.hiddenAfter === 1 ? '' : 's'} below - PgDn to return`}
        </Text>
      ) : null}
    </Box>
  )
}

function resolveViewportState(
  state: TranscriptViewportState,
  rowIds: string[],
  offsets: number[],
  maxScrollTop: number,
): TranscriptViewportState {
  if (rowIds.length === 0) {
    return { scrollTopLine: 0, followTail: true, anchor: null }
  }

  const scrollTopLine = state.followTail
    ? maxScrollTop
    : resolveScrollTopFromAnchor(rowIds, offsets, state.anchor, maxScrollTop)
      ?? clampLine(state.scrollTopLine, maxScrollTop)

  return viewportForScrollTop(scrollTopLine, rowIds, offsets, maxScrollTop)
}

function viewportForScrollTop(
  scrollTopLine: number,
  rowIds: string[],
  offsets: number[],
  maxScrollTop: number,
): TranscriptViewportState {
  const clamped = clampLine(scrollTopLine, maxScrollTop)
  const followTail = clamped >= maxScrollTop
  return {
    scrollTopLine: clamped,
    followTail,
    anchor: followTail ? null : anchorForScrollTop(rowIds, offsets, clamped),
  }
}

function trimSelectionToFocusedTurn(
  selection: TranscriptWindowSelection<MessageRow>,
  rows: MessageRow[],
  state: TranscriptViewportState,
): TranscriptWindowSelection<MessageRow> {
  if (state.followTail || state.anchor?.offset !== 0) return selection
  const focusedIndex = rows.findIndex(row => row.id === state.anchor?.rowId)
  if (focusedIndex === -1 || rows[focusedIndex]?.role !== 'user') return selection
  const firstSelected = selection.rows[0]
  if (!firstSelected || firstSelected.id !== state.anchor.rowId) return selection

  const nextPromptIndex = selection.rows.findIndex((row, index) => index > 0 && row.role === 'user')
  if (nextPromptIndex === -1) return selection

  return {
    ...selection,
    rows: selection.rows.slice(0, nextPromptIndex),
    hiddenAfter: selection.hiddenAfter + selection.rows.length - nextPromptIndex,
  }
}

function sameViewportState(left: TranscriptViewportState, right: TranscriptViewportState): boolean {
  return left.scrollTopLine === right.scrollTopLine
    && left.followTail === right.followTail
    && left.anchor?.rowId === right.anchor?.rowId
    && left.anchor?.offset === right.anchor?.offset
}
