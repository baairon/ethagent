import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatLocalHfModelDisplayName,
  formatModelDisplayName,
  truncateMiddle,
} from '../../src/models/modelDisplay.js'

test('local Hugging Face model ids render as repo and filename', () => {
  assert.equal(
    formatModelDisplayName('llamacpp', 'org/model-GGUF#nested/model.Q4_K_M.gguf'),
    'org/model-GGUF / model.Q4_K_M.gguf',
  )
})

test('long local Hugging Face model names compact to clean repo and file labels', () => {
  const id = 'very-long-organization-name/very-long-model-name-with-extra-descriptors-GGUF#nested/folder/model-name-with-a-very-long-quantization-and-context-label.Q4_K_M.gguf'
  const label = formatLocalHfModelDisplayName(id, { maxLength: 56 })

  assert.ok(label.length <= 56)
  assert.match(label, / \/ /)
  assert.match(label, /Q4_K_M$/)
  assert.doesNotMatch(label, /#/)
  assert.doesNotMatch(label, /\.\.\./)
})

test('short local Hugging Face model labels keep the model family, size, and quantization', () => {
  const id = 'HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive#Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf'
  const label = formatLocalHfModelDisplayName(id, { maxLength: 24 })

  assert.equal(label, 'Qwen3.5 9B Q4_K_M')
  assert.ok(label.length <= 24)
  assert.doesNotMatch(label, /\.\.\./)
  assert.doesNotMatch(label, /\.gguf/)
})

test('non-local provider display keeps normal model names readable', () => {
  assert.equal(formatModelDisplayName('openai', 'gpt-5.2'), 'gpt-5.2')
  assert.equal(truncateMiddle('abcdefghijklmnopqrstuvwxyz', 12), 'abcde...wxyz')
})
