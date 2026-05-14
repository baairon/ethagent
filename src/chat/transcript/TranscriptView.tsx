import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useAppInput } from '../../app/input/AppInputProvider.js'
import { MessageList, type MessageRow } from '../MessageList.js'
import { theme } from '../../ui/theme.js'
import {
  anchorForScrollTop,
  buildLineOffsets,
  clampLine,
  estimateMessageRowHeight,
  resolveScrollTopFromAnchor,
  scrollTopForPageDown,
  scrollTopForPageUp,
  selectRowsForScrollTop,
  type TranscriptViewportState,
} from './transcriptViewport.js'

type TranscriptViewProps = {
  rows: MessageRow[]
  active?: boolean
  bottomVariant?: 'prompt' | 'overlay'
  onVisibleReasoningIdsChange?: (ids: string[]) => void
  onScrollabilityChange?: (canScroll: boolean) => void
}

const PROMPT_RESERVED_LINES = 12
const OVERLAY_RESERVED_LINES = 16
const MIN_TRANSCRIPT_LINES = 6
const MAX_TRANSCRIPT_LINES = 240

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  rows,
  active = true,
  bottomVariant = 'prompt',
  onVisibleReasoningIdsChange,
  onScrollabilityChange,
}) => {
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
    () => selectRowsForScrollTop(
      rows,
      maxLines,
      resolvedViewportState.scrollTopLine,
      row => estimateMessageRowHeight(row, columns),
    ),
    [columns, maxLines, resolvedViewportState, rows],
  )
  const visibleReasoningIds = useMemo(
    () => selection.rows
      .filter((slice): slice is { row: Extract<MessageRow, { role: 'thinking' }>; clipStart: number; clipEnd: number; rowHeight: number } =>
        slice.row.role === 'thinking',
      )
      .map(slice => slice.row.id),
    [selection.rows],
  )

  useEffect(() => {
    setViewportState(prev => sameViewportState(prev, resolvedViewportState) ? prev : resolvedViewportState)
  }, [resolvedViewportState])

  useEffect(() => {
    onVisibleReasoningIdsChange?.(visibleReasoningIds)
  }, [onVisibleReasoningIdsChange, visibleReasoningIds])

  useEffect(() => {
    onScrollabilityChange?.(metrics.maxScrollTop > 0)
  }, [metrics.maxScrollTop, onScrollabilityChange])

  useAppInput((_input, key) => {
    if (key.pageUp) {
      const target = scrollTopForPageUp(
        resolvedViewportState.scrollTopLine,
        metrics.maxScrollTop,
        maxLines,
      )
      setViewportState(viewportForScrollTop(
        target,
        metrics.rowIds,
        metrics.offsets,
        metrics.maxScrollTop,
      ))
    } else if (key.pageDown) {
      const target = scrollTopForPageDown(
        resolvedViewportState.scrollTopLine,
        metrics.maxScrollTop,
        maxLines,
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
      {selection.hiddenBefore > 0 ? (
        <Text color={theme.dim}>
          {`  ${selection.hiddenBefore} earlier message${selection.hiddenBefore === 1 ? '' : 's'} above · `}
          <Text color={theme.accentPeriwinkle}>pgup</Text>
          {` to scroll · `}
          <Text color={theme.accentPeriwinkle}>/export</Text>
          {` saves the full transcript`}
        </Text>
      ) : null}
      <MessageList slices={selection.rows} />
      {selection.hiddenAfter > 0 ? (
        <Text color={theme.dim}>
          {`  ${selection.hiddenAfter} later message${selection.hiddenAfter === 1 ? '' : 's'} below · `}
          <Text color={theme.accentPeriwinkle}>pgdn</Text>
          {` to return`}
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

function sameViewportState(left: TranscriptViewportState, right: TranscriptViewportState): boolean {
  return left.scrollTopLine === right.scrollTopLine
    && left.followTail === right.followTail
    && left.anchor?.rowId === right.anchor?.rowId
    && left.anchor?.offset === right.anchor?.offset
}
