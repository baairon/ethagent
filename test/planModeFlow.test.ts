import test from 'node:test'
import assert from 'node:assert/strict'
import { getSlashSuggestions } from '../src/commands/index.js'
import { buildSystemPrompt } from '../src/prompts/systemPrompt.js'
import { createProvider } from '../src/providers/registry.js'
import { modePolicy } from '../src/runtime/modePolicy.js'
import { toolsForMode } from '../src/tools/registry.js'

test('plan mode exposes only read tools to the model', () => {
  const planTools = toolsForMode('plan').map(tool => tool.name)
  assert.deepEqual(planTools.sort(), ['list_directory', 'read_file'].sort())
  assert.ok(!planTools.includes('edit_file'))
  assert.ok(!planTools.includes('run_bash'))
  assert.ok(!planTools.includes('change_directory'))
})

test('provider support reflects mode-filtered tools', () => {
  const config = {
    version: 1 as const,
    provider: 'ollama' as const,
    model: 'qwen-test',
    firstRunAt: '2026-04-21T00:00:00.000Z',
  }
  assert.equal(createProvider(config, { mode: 'plan' }).supportsTools, true)
  assert.equal(createProvider(config, { mode: 'chat' }).supportsTools, true)
})

test('mode policy keeps plan, default, and accept-edits distinct', () => {
  const plan = modePolicy('plan')
  assert.equal(plan.exposesToolKind('edit'), false)
  assert.equal(plan.exposesToolKind('delete'), false)
  assert.equal(plan.exposesToolKind('read'), true)

  const chat = modePolicy('chat')
  assert.equal(chat.autoAllowToolKind('edit'), false)
  assert.equal(chat.autoAllowToolKind('delete'), false)

  const acceptEdits = modePolicy('accept-edits')
  assert.equal(acceptEdits.exposesToolKind('edit'), true)
  assert.equal(acceptEdits.exposesToolKind('delete'), true)
  assert.equal(acceptEdits.autoAllowToolKind('edit'), true)
  assert.equal(acceptEdits.autoAllowToolKind('delete'), false)
  assert.equal(acceptEdits.autoAllowToolKind('bash'), false)
})

test('plan mode prompt tells the model to plan instead of mutate', () => {
  const prompt = buildSystemPrompt({
    cwd: '/tmp/project',
    model: 'qwen-test',
    provider: 'ollama',
    hasTools: true,
    mode: 'plan',
  })
  assert.match(prompt, /PLAN MODE ACTIVE/)
  assert.match(prompt, /Inspect only/)
  assert.doesNotMatch(prompt, /EXECUTION MODE ACTIVE/)
  assert.doesNotMatch(prompt, /Use `edit_file` to mutate/)
})

test('/implement is not part of the slash command UX', () => {
  const suggestions = getSlashSuggestions().map(suggestion => suggestion.name)
  assert.ok(!suggestions.includes('implement'))
})
