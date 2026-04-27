import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectDirectToolIntent,
  validateAssistantTextAgainstTurnEvidence,
} from '../src/runtime/toolIntent.js'

test('detectDirectToolIntent routes specific requests to typed intents', () => {
  const cdIntent = detectDirectToolIntent('cd into src')
  assert.deepEqual(cdIntent, {
    name: 'change_directory',
    input: { path: 'src' },
    reason: 'user requested directory change to src',
  })

  const lsIntent = detectDirectToolIntent('what is in here?')
  assert.deepEqual(lsIntent, {
    name: 'list_directory',
    input: { path: '.' },
    reason: 'user requested directory listing',
  })

  const readIntent = detectDirectToolIntent('open package.json')
  assert.deepEqual(readIntent, {
    name: 'read_file',
    input: { path: 'package.json' },
    reason: 'user requested read of package.json',
  })

  const ambiguousIntent = detectDirectToolIntent('fix the typo in src/utils.ts')
  assert.equal(ambiguousIntent, null)
})

test('validateAssistantTextAgainstTurnEvidence flags unsupported claims', () => {
  assert.equal(
    validateAssistantTextAgainstTurnEvidence(
      'I have read the file. The contents show a function...',
      [{ name: 'read_file', result: { ok: true } }]
    ),
    'ok',
  )

  assert.equal(
    validateAssistantTextAgainstTurnEvidence(
      "The directory doesn't exist.",
      [] // No evidence
    ),
    'needs-tool',
  )
})
