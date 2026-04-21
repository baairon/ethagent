import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildToolInputRepairPrompt,
  buildToolRetryPrompt,
  normalizeToolWorkFromAssistant,
  shouldRetryRejectedToolInput,
} from '../src/runtime/turnPolicy.js'

test('normalizeToolWorkFromAssistant rejects destructive empty edit repair', () => {
  const repaired = normalizeToolWorkFromAssistant(
    'delete the index.html file',
    'edit_file {"name":"edit_file","arguments":{"path":"index.html","newText":""}}',
  )

  assert.equal(repaired.repairStatus, 'failed')
  assert.equal(repaired.toolUses.length, 0)
  assert.match(repaired.repairMessage ?? '', /explicit delete command/i)
})

test('buildToolRetryPrompt pushes direct tool use expectations', () => {
  const prompt = buildToolRetryPrompt('~/Downloads/example')

  assert.match(prompt, /list_directory first/i)
  assert.match(prompt, /Do not tell the user to copy, paste, save, or create files manually/i)
  assert.match(prompt, /Call run_bash with the exact command/i)
})

test('shouldRetryRejectedToolInput only retries schema rejections', () => {
  assert.equal(
    shouldRetryRejectedToolInput({ ok: false, summary: 'edit_file rejected input', content: 'missing required fields: path' }),
    true,
  )
  assert.equal(
    shouldRetryRejectedToolInput({ ok: false, summary: 'edit_file failed', content: 'permission denied' }),
    false,
  )
})

test('buildToolInputRepairPrompt keeps cwd and tool context in the retry message', () => {
  const prompt = buildToolInputRepairPrompt('~/Downloads/example', 'edit_file', 'missing required fields: path')

  assert.match(prompt, /edit_file tool call used invalid or incomplete arguments/i)
  assert.match(prompt, /missing required fields: path/i)
  assert.match(prompt, /~\/Downloads\/example/)
})
