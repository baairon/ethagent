import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expandImageRefs,
  formatImageRefMarker,
  pruneImageRefs,
  referencedImageIds,
} from '../../src/chat/input/imageRefs.js'

test('formatImageRefMarker emits the canonical bracketed form', () => {
  assert.equal(formatImageRefMarker(1), '[Image #1]')
  assert.equal(formatImageRefMarker(42), '[Image #42]')
})

test('expandImageRefs swaps known #N markers for their absolute path', () => {
  const refs = new Map([
    [1, { path: '/tmp/a.png' }],
    [2, { path: 'C:/users/me/b.png' }],
  ])
  const out = expandImageRefs('look at [Image #1] and [Image #2] please', refs)
  assert.equal(out, 'look at [image: /tmp/a.png] and [image: C:/users/me/b.png] please')
})

test('expandImageRefs leaves unknown #N markers verbatim instead of corrupting them', () => {
  const refs = new Map([[1, { path: '/tmp/a.png' }]])
  const out = expandImageRefs('have [Image #1] not [Image #99]', refs)
  assert.equal(out, 'have [image: /tmp/a.png] not [Image #99]')
})

test('expandImageRefs is a no-op when there are no refs', () => {
  const out = expandImageRefs('just plain text here', new Map())
  assert.equal(out, 'just plain text here')
})

test('referencedImageIds collects every #N integer from a prompt', () => {
  const ids = referencedImageIds('first [Image #1] then [Image #7] and [Image #1] again')
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 7])
})

test('referencedImageIds returns an empty set when no markers exist', () => {
  assert.equal(referencedImageIds('no images here at all').size, 0)
})

test('pruneImageRefs evicts entries whose marker text was removed', () => {
  const refs = new Map([
    [1, { path: '/tmp/a.png' }],
    [2, { path: '/tmp/b.png' }],
    [3, { path: '/tmp/c.png' }],
  ])
  pruneImageRefs(refs, 'keep only [Image #2] in the prompt')
  assert.equal(refs.size, 1)
  assert.equal(refs.get(2)?.path, '/tmp/b.png')
})

test('pruneImageRefs clears every entry when no markers remain', () => {
  const refs = new Map([[1, { path: '/tmp/a.png' }]])
  pruneImageRefs(refs, 'user deleted all markers')
  assert.equal(refs.size, 0)
})
