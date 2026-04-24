import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expandPastedTextRefs,
  formatPastedTextRef,
  normalizePastedText,
  shouldCollapsePastedText,
} from '../src/ui/chatPaste.js'

test('normalizePastedText strips paste control artifacts and normalizes newlines', () => {
  assert.equal(
    normalizePastedText(`\x1b[200~a\r\nb\x1b[201~\n201~`),
    'a\nb\n',
  )
})

test('shouldCollapsePastedText collapses long or tall pasted bodies', () => {
  assert.equal(shouldCollapsePastedText('a'.repeat(801), 2), true)
  assert.equal(shouldCollapsePastedText('a\nb\nc\nd', 2), true)
  assert.equal(shouldCollapsePastedText('short\nbody', 2), false)
})

test('formatPastedTextRef and expandPastedTextRefs round-trip large paste placeholders', () => {
  const refs = new Map([[1, { id: 1, content: 'alpha\nbeta' }]])
  const placeholder = formatPastedTextRef(1, 'alpha\nbeta'.length)

  assert.equal(placeholder, '[Pasted Content 10 chars #1]')
  assert.equal(expandPastedTextRefs(`before ${placeholder} after`, refs), 'before alpha\nbeta after')
})

test('expandPastedTextRefs does not expand placeholder-like strings from pasted content', () => {
  const refs = new Map([
    [1, { id: 1, content: '[Pasted Content 3 chars #2]' }],
    [2, { id: 2, content: 'bad' }],
  ])

  assert.equal(
    expandPastedTextRefs('[Pasted Content 25 chars #1]', refs),
    '[Pasted Content 3 chars #2]',
  )
})
