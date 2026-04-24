import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlanImplementationPrompt } from '../src/ui/ChatScreen.js'

test('buildPlanImplementationPrompt makes native tools authoritative over bash-biased plan wording', () => {
  const prompt = buildPlanImplementationPrompt([
    'Implementation steps will be executed as commands within a Bash script or directly in the terminal.',
    'Create index.html.',
  ].join('\n'))

  assert.match(prompt, /Use native ethagent tools directly/i)
  assert.match(prompt, /Do not translate tool names into shell commands/i)
  assert.match(prompt, /Ignore any plan wording that says to execute file work as a Bash script/i)
  assert.match(prompt, /call edit_file directly/i)
})
