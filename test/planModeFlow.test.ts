import test from 'node:test'
import assert from 'node:assert/strict'
import { getSlashSuggestions } from '../src/chat/commands.js'
import { buildSystemPrompt } from '../src/runtime/systemPrompt.js'
import { createProvider } from '../src/providers/registry.js'
import { modePolicy } from '../src/runtime/sessionMode.js'
import { toolsForMode } from '../src/tools/registry.js'

test('plan mode exposes only read tools to the model', () => {
  const planTools = toolsForMode('plan').map(tool => tool.name)
  assert.deepEqual(planTools.sort(), ['list_directory', 'list_mcp_resources', 'read_file', 'read_mcp_resource'].sort())
  assert.ok(!planTools.includes('edit_file'))
  assert.ok(!planTools.includes('run_bash'))
  assert.ok(!planTools.includes('change_directory'))

  const identityPlanTools = toolsForMode('plan', { hasIdentity: true }).map(tool => tool.name)
  assert.ok(identityPlanTools.includes('read_private_continuity_file'))
  assert.ok(!identityPlanTools.includes('propose_private_continuity_edit'))
})

test('private continuity edit tool is exposed only when an identity is linked', () => {
  const withoutIdentity = toolsForMode('chat', { hasIdentity: false }).map(tool => tool.name)
  assert.ok(!withoutIdentity.includes('propose_private_continuity_edit'))
  assert.ok(!withoutIdentity.includes('read_private_continuity_file'))

  const withIdentity = toolsForMode('chat', { hasIdentity: true }).map(tool => tool.name)
  assert.ok(withIdentity.includes('propose_private_continuity_edit'))
  assert.ok(withIdentity.includes('read_private_continuity_file'))
})

test('private continuity tools tell models not to locate vault markdown in the workspace', () => {
  const tool = toolsForMode('chat', { hasIdentity: true })
    .find(candidate => candidate.name === 'propose_private_continuity_edit')
  assert.ok(tool)
  assert.match(tool.description, /Do not call read_file, list_directory, or run_bash to locate these files/)
  assert.match(tool.description, /this tool resolves the vault path/)
  assert.match(tool.description, /For new memories or preferences/)
  assert.match(JSON.stringify(tool.inputSchemaJson), /Use only the file name/)
  assert.match(JSON.stringify(tool.inputSchemaJson), /Prefer this for new notes/)
  assert.deepEqual(tool.inputSchemaJson.required, ['file'])
  assert.equal(tool.inputSchemaJson.oneOf, undefined)
  assert.match(JSON.stringify(tool.inputSchemaJson.properties), /appendToSection/)
  assert.match(JSON.stringify(tool.inputSchemaJson.properties), /appendText/)
  assert.match(JSON.stringify(tool.inputSchemaJson.properties), /oldText/)
  assert.match(JSON.stringify(tool.inputSchemaJson.properties), /newText/)

  const readTool = toolsForMode('chat', { hasIdentity: true })
    .find(candidate => candidate.name === 'read_private_continuity_file')
  assert.ok(readTool)
  assert.match(readTool.description, /do not use workspace read_file/)
  assert.match(readTool.description, /surgical removals/)
  assert.match(JSON.stringify(readTool.inputSchemaJson.properties), /Use only the file name/)
})

test('provider support reflects mode-filtered tools', () => {
  const config = {
    version: 1 as const,
    provider: 'llamacpp' as const,
    model: 'org/model#model.gguf',
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
  assert.equal(plan.exposesToolKind('mcp'), true)

  const chat = modePolicy('chat')
  assert.equal(chat.autoAllowToolKind('edit'), false)
  assert.equal(chat.autoAllowToolKind('delete'), false)

  const acceptEdits = modePolicy('accept-edits')
  assert.equal(acceptEdits.exposesToolKind('edit'), true)
  assert.equal(acceptEdits.exposesToolKind('delete'), true)
  assert.equal(acceptEdits.autoAllowToolKind('edit'), true)
  assert.equal(acceptEdits.autoAllowToolKind('private-continuity-edit'), false)
  assert.equal(acceptEdits.autoAllowToolKind('private-continuity-read'), true)
  assert.equal(acceptEdits.autoAllowToolKind('delete'), false)
  assert.equal(acceptEdits.autoAllowToolKind('bash'), false)
})

test('plan mode prompt tells the model to plan instead of mutate', () => {
  const prompt = buildSystemPrompt({
    cwd: '/tmp/project',
    model: 'org/model#model.gguf',
    provider: 'llamacpp',
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
