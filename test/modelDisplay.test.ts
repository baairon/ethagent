import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatLocalHfModelDisplayName,
  formatModelDisplayName,
  truncateMiddle,
} from '../src/models/modelDisplay.js'

test('local Hugging Face model ids render as repo and filename', () => {
  assert.equal(
    formatModelDisplayName('llamacpp', 'org/model-GGUF#nested/model.Q4_K_M.gguf'),
    'org/model-GGUF / model.Q4_K_M.gguf',
  )
})

test('long local Hugging Face model names middle truncate repo and file parts', () => {
  const id = 'very-long-organization-name/very-long-model-name-with-extra-descriptors-GGUF#nested/folder/model-name-with-a-very-long-quantization-and-context-label.Q4_K_M.gguf'
  const label = formatLocalHfModelDisplayName(id, { maxLength: 56 })

  assert.ok(label.length <= 56)
  assert.match(label, / \/ /)
  assert.match(label, /\.\.\./)
  assert.match(label, /\.gguf$/)
  assert.doesNotMatch(label, /#/)
})

test('non-local provider display keeps normal model names readable', () => {
  assert.equal(formatModelDisplayName('openai', 'gpt-5.2'), 'gpt-5.2')
  assert.equal(truncateMiddle('abcdefghijklmnopqrstuvwxyz', 12), 'abcde...wxyz')
})
