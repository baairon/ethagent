import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResponsesBody } from '../../src/providers/openai-responses-format.js'

test('Responses body folds system messages into instructions', () => {
  const body = buildResponsesBody({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi there' },
    ],
    tools: [],
  })

  assert.equal(body.instructions, 'You are helpful.\n\nBe concise.')
  assert.deepEqual(body.input, [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hi there' }],
    },
  ])
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
})

test('Responses body emits function_call and function_call_output items', () => {
  const body = buildResponsesBody({
    model: 'gpt-5-codex',
    messages: [
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Calling tool.' },
          { type: 'tool_use', id: 'call-1', name: 'list_dir', input: { path: '.' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call-1', content: 'a.txt\nb.txt' },
        ],
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'list_dir',
          description: 'list a directory',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ],
  })

  assert.equal(body.tools?.length, 1)
  assert.equal(body.tools?.[0]?.name, 'list_dir')
  assert.equal(body.parallel_tool_calls, true)
  assert.equal(body.tool_choice, 'auto')

  const types = body.input.map(item => item.type)
  assert.deepEqual(types, ['message', 'message', 'function_call', 'function_call_output'])

  const fnCall = body.input[2]
  assert.equal(fnCall?.type, 'function_call')
  if (fnCall && fnCall.type === 'function_call') {
    assert.equal(fnCall.call_id, 'call-1')
    assert.equal(fnCall.name, 'list_dir')
    assert.equal(fnCall.arguments, JSON.stringify({ path: '.' }))
  }

  const fnOutput = body.input[3]
  assert.equal(fnOutput?.type, 'function_call_output')
  if (fnOutput && fnOutput.type === 'function_call_output') {
    assert.equal(fnOutput.call_id, 'call-1')
    assert.equal(fnOutput.output, 'a.txt\nb.txt')
  }
})

test('Responses body omits instructions when no system messages are present', () => {
  const body = buildResponsesBody({
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
  })
  assert.equal(body.instructions, undefined)
})
