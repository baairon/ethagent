import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { theme, gradientColor } from '../../../../ui/theme.js'
import { useContentWidth } from '../../../../ui/layout.js'
import { firstThatFits, wrapWords } from '../../../../ui/text.js'
import { useAppInput } from '../../../../app/input/AppInputProvider.js'

export type LazyMenuItem<T> = {
  kind?: 'item'
  value: T
  label: string
  shortcut?: string
  disabled?: boolean
  hint?: string
  note?: string
  noteColor?: string
  inlineNote?: string | readonly string[]
  inlineNoteColor?: string
}

export type LazyMenuSection = {
  kind: 'section'
  label: string
}

export type LazyMenuRow<T> = LazyMenuItem<T> | LazyMenuSection

function isItem<T>(row: LazyMenuRow<T>): row is LazyMenuItem<T> {
  return row.kind !== 'section'
}

function rainbowColor(index: number, total: number): string {
  return gradientColor(total <= 1 ? 0 : index / (total - 1))
}

type Props<T> = {
  rows: Array<LazyMenuRow<T>>
  width?: number
  onSubmit: (value: T) => void
  onCancel?: () => void
}

export function LazyMenu<T>({ rows, width, onSubmit, onCancel }: Props<T>) {
  const contentWidth = useContentWidth()
  const menuWidth = width ?? contentWidth
  const firstSelectable = Math.max(0, rows.findIndex(r => isItem(r) && !r.disabled))
  const [index, setIndex] = useState(firstSelectable)

  const sig = useMemo(
    () => rows.map(r => isItem(r) ? `i:${r.shortcut ?? ''}${r.disabled ? '!' : ''}` : `s:${r.label}`).join('|'),
    [rows],
  )
  useEffect(() => {
    setIndex(prev => {
      const at = rows[prev]
      if (at && isItem(at) && !at.disabled) return prev
      const next = rows.findIndex(r => isItem(r) && !r.disabled)
      return next === -1 ? 0 : next
    })
  }, [sig, rows])

  const moveBy = (delta: number) => {
    if (rows.length === 0) return
    let next = index
    for (let i = 0; i < rows.length; i += 1) {
      next = (next + delta + rows.length) % rows.length
      const candidate = rows[next]
      if (candidate && isItem(candidate) && !candidate.disabled) { setIndex(next); return }
    }
  }

  useAppInput((input, key) => {
    if (key.upArrow || input === 'k') moveBy(-1)
    else if (key.downArrow || input === 'j') moveBy(1)
    else if (key.return) {
      const r = rows[index]
      if (r && isItem(r) && !r.disabled) onSubmit(r.value)
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
    } else if (input && !key.ctrl && !key.meta) {
      const lower = input.toLowerCase()
      const hit = rows.findIndex(r => isItem(r) && !r.disabled && r.shortcut?.toLowerCase() === lower)
      if (hit >= 0) {
        const candidate = rows[hit]!
        if (isItem(candidate)) { setIndex(hit); onSubmit(candidate.value) }
      }
    }
  })

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => {
        if (!isItem(row)) {
          return (
            <Box key={i} flexDirection="row" width={menuWidth}>
              <Text color={theme.menuStatus} bold>{row.label}</Text>
            </Box>
          )
        }
        const active = i === index
        const disabled = !!row.disabled
        const cursorColor = disabled ? theme.border : active ? theme.accentPeriwinkle : theme.dim
        const shortcutColor = disabled ? theme.border : theme.menuShortcut
        const chars = row.label.split('')
        const shortcut = row.shortcut
        const noteBudget = menuWidth - 2 - row.label.length - 2 - (shortcut ? shortcut.length + 2 : 0)
        const candidates = row.inlineNote === undefined
          ? []
          : typeof row.inlineNote === 'string' ? [row.inlineNote] : row.inlineNote
        const inline = candidates.length > 0 ? firstThatFits(candidates, noteBudget) ?? '' : ''
        const overflow = candidates.length > 0 && !inline ? candidates[0]! : ''
        const inlineWidth = inline ? inline.length + 2 : 0
        const pad = shortcut ? Math.max(2, menuWidth - (2 + row.label.length + inlineWidth + shortcut.length)) : 0
        return (
          <React.Fragment key={i}>
            <Box flexDirection="row" {...(shortcut ? { width: menuWidth } : {})}>
              <Text color={cursorColor}>{active ? '❯ ' : '  '}</Text>
              <Text>
                {active && !disabled
                  ? chars.map((ch, ci) => (
                      <Text key={ci} color={rainbowColor(ci, chars.length)}>{ch}</Text>
                    ))
                  : <Text color={disabled ? theme.border : theme.text}>{row.label}</Text>
                }
              </Text>
              {inline ? (
                <>
                  <Text>{'  '}</Text>
                  <Text color={row.inlineNoteColor ?? theme.dim}>{inline}</Text>
                </>
              ) : null}
              {shortcut ? (
                <>
                  <Text>{' '.repeat(pad)}</Text>
                  <Text color={shortcutColor}>{shortcut}</Text>
                </>
              ) : null}
            </Box>
            {overflow ? (
              <Box paddingLeft={2}>
                <Text color={row.inlineNoteColor ?? theme.dim}>{wrapWords(overflow, menuWidth - 2).join('\n')}</Text>
              </Box>
            ) : null}
            {row.hint && disabled ? (
              <Box paddingLeft={2}>
                <Text color={theme.dim}>{wrapWords(row.hint, menuWidth - 2).join('\n')}</Text>
              </Box>
            ) : null}
            {row.note ? (
              <Box paddingLeft={2}>
                <Text color={row.noteColor ?? theme.dim}>{wrapWords(row.note, menuWidth - 2).join('\n')}</Text>
              </Box>
            ) : null}
          </React.Fragment>
        )
      })}
    </Box>
  )
}
