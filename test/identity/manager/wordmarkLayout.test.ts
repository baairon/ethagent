import test from 'node:test'
import assert from 'node:assert/strict'
import { wordmarkLayout } from '../../../src/identity/manager/shared/components/Wordmark.js'

test('wordmarkLayout shows decorations only when both 12-col gutters fit beside the 69-col banner', () => {
  assert.equal(wordmarkLayout(120), 'full')
  assert.equal(wordmarkLayout(93), 'full')
})

test('wordmarkLayout sheds the left and right decorations before the banner can mangle', () => {
  assert.equal(wordmarkLayout(92), 'bare')
  assert.equal(wordmarkLayout(80), 'bare')
  assert.equal(wordmarkLayout(69), 'bare')
})

test('wordmarkLayout purges the wordmark entirely once even the banner would wrap', () => {
  assert.equal(wordmarkLayout(68), 'hidden')
  assert.equal(wordmarkLayout(40), 'hidden')
  assert.equal(wordmarkLayout(0), 'hidden')
})
