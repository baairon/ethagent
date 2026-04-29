import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPlanImplementationPrompt,
  buildPlanTransferSeedMessages,
} from '../src/ui/ChatScreen.js'
import { PLAN_APPROVAL_OPTIONS } from '../src/ui/PlanApprovalView.js'
import { CONTEXT_LIMIT_OPTIONS } from '../src/ui/ContextLimitView.js'

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

test('plan approval options include one clear new-conversation choice', () => {
  assert.deepEqual(
    PLAN_APPROVAL_OPTIONS.map(option => option.value),
    ['apply', 'apply-summary', 'continue'],
  )
  assert.equal(
    PLAN_APPROVAL_OPTIONS.find(option => option.value === 'apply')?.label,
    'Yes, implement this plan',
  )
  assert.equal(
    PLAN_APPROVAL_OPTIONS.find(option => option.value === 'apply-summary')?.label,
    'Yes, start a new conversation',
  )
  assert.equal(
    PLAN_APPROVAL_OPTIONS.find(option => option.value === 'continue')?.label,
    'No, stay in Plan mode',
  )
})

test('buildPlanTransferSeedMessages carries summary and approved plan into a new conversation', () => {
  const messages = buildPlanTransferSeedMessages({
    sourceSessionId: 'session-abcdef123456',
    summary: 'Important planning context.',
    plan: '1. Edit the UI.\n2. Run tests.',
    createdAt: '2026-04-28T00:00:00.000Z',
  })

  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.role, 'user')
  assert.equal(messages[0]?.synthetic, true)
  assert.match(String(messages[0]?.content), /Planning handoff from session-/)
  assert.match(String(messages[0]?.content), /Important planning context/)
  assert.equal(messages[1]?.role, 'user')
  assert.equal(messages[1]?.synthetic, true)
  assert.match(String(messages[1]?.content), /Approved plan to implement/)
  assert.match(String(messages[1]?.content), /Run tests/)
})

test('context limit options keep explicit send override available', () => {
  assert.deepEqual(
    CONTEXT_LIMIT_OPTIONS.map(option => option.action),
    ['compact', 'switchModel', 'send', 'cancel'],
  )
  assert.equal(
    CONTEXT_LIMIT_OPTIONS.find(option => option.action === 'send')?.label,
    'Ignore warning and send',
  )
  assert.match(
    CONTEXT_LIMIT_OPTIONS.find(option => option.action === 'send')?.detail ?? '',
    /rate\/context limits|degrade local\/cloud model behavior/,
  )
})
