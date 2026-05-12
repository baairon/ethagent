import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFileChangeResult,
  renderUnifiedFileDiff,
  splitFileChangeResult,
  stripFileChangeResultDiff,
} from '../../src/tools/fileDiff.js'

test('renderUnifiedFileDiff shows a unified diff for targeted edits', () => {
  const diff = renderUnifiedFileDiff({
    filePath: 'src/example.ts',
    before: 'alpha\nbeta\ngamma\n',
    after: 'alpha\nBETTER\ngamma\n',
  })

  assert.equal(diff, [
    '--- src/example.ts',
    '+++ src/example.ts',
    '@@ -1,3 +1,3 @@',
    ' alpha',
    '-beta',
    '+BETTER',
    ' gamma',
  ].join('\n'))
})

test('renderUnifiedFileDiff shows creation and deletion ranges', () => {
  const created = renderUnifiedFileDiff({
    filePath: 'new.txt',
    before: '',
    after: 'one\ntwo\n',
  })
  const deleted = renderUnifiedFileDiff({
    filePath: 'old.txt',
    before: 'one\ntwo\n',
    after: '',
  })

  assert.match(created, /@@ -0,0 \+1,2 @@/)
  assert.match(created, /^\+one$/m)
  assert.match(created, /^\+two$/m)
  assert.match(deleted, /@@ -1,2 \+0,0 @@/)
  assert.match(deleted, /^-one$/m)
  assert.match(deleted, /^-two$/m)
})

test('renderUnifiedFileDiff separates distant edits into context hunks', () => {
  const diff = renderUnifiedFileDiff({
    filePath: 'letters.txt',
    before: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n',
    after: 'a\nB\nc\nd\ne\nf\ng\nh\nI\nj\n',
    contextLines: 1,
  })

  assert.match(diff, /@@ -1,3 \+1,3 @@/)
  assert.match(diff, /@@ -8,3 \+8,3 @@/)
  assert.match(diff, /^-b$/m)
  assert.match(diff, /^\+B$/m)
  assert.match(diff, /^-i$/m)
  assert.match(diff, /^\+I$/m)
})

test('renderUnifiedFileDiff reports line-ending-only changes without fake additions', () => {
  const diff = renderUnifiedFileDiff({
    filePath: 'line-endings.txt',
    before: 'alpha\r\n',
    after: 'alpha\n',
  })

  assert.match(diff, /\(only line ending changes\)/)
  assert.doesNotMatch(diff, /^-alpha$/m)
  assert.doesNotMatch(diff, /^\+alpha$/m)
})

test('renderUnifiedFileDiff truncates oversized previews on line boundaries without a marker', () => {
  const diff = renderUnifiedFileDiff({
    filePath: 'large.txt',
    before: Array.from({ length: 40 }, (_, index) => `old-${index}`).join('\n'),
    after: Array.from({ length: 40 }, (_, index) => `new-${index}`).join('\n'),
    maxChars: 120,
  })

  assert.ok(diff.length <= 120)
  assert.doesNotMatch(diff, /diff preview truncated/)
})

test('file change result helpers preserve hidden diff payloads for UI restore', () => {
  const result = formatFileChangeResult('updated C:/tmp/a.txt', '--- a.txt\n+++ a.txt\n+new')

  assert.deepEqual(splitFileChangeResult(result), {
    content: 'updated C:/tmp/a.txt',
    diff: '--- a.txt\n+++ a.txt\n+new',
  })
  assert.equal(stripFileChangeResultDiff(result), 'updated C:/tmp/a.txt')
})
