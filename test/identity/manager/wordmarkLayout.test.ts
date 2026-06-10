import test from 'node:test'
import assert from 'node:assert/strict'
import { wordmarkLayout } from '../../../src/identity/manager/shared/components/Wordmark.js'

test('wordmarkLayout shows the full banner whenever its 69 columns fit', () => {
  assert.equal(wordmarkLayout(120), 'bare')
  assert.equal(wordmarkLayout(80), 'bare')
  assert.equal(wordmarkLayout(69), 'bare')
})

test('wordmarkLayout falls back to the compact one-line wordmark once even the banner would wrap', () => {
  assert.equal(wordmarkLayout(68), 'compact')
  assert.equal(wordmarkLayout(40), 'compact')
  assert.equal(wordmarkLayout(0), 'compact')
})
