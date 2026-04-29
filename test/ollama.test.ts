import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteModel } from '../src/bootstrap/ollama.js'

test('deleteModel removes an Ollama model through the local API', async () => {
  let url = ''
  let init: RequestInit | undefined
  const fetchImpl = (async (input, options) => {
    url = String(input)
    init = options
    return new Response(null, { status: 200 })
  }) as typeof fetch

  await deleteModel('qwen2.5-coder:7b', 'http://127.0.0.1:11434', fetchImpl)

  assert.equal(url, 'http://127.0.0.1:11434/api/delete')
  assert.equal(init?.method, 'DELETE')
  assert.equal(init?.body, JSON.stringify({ model: 'qwen2.5-coder:7b' }))
})

test('deleteModel reports busy Ollama models with retryable copy', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ error: 'model is currently in use' }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch

  await assert.rejects(
    deleteModel('qwen2.5-coder:7b', 'http://127.0.0.1:11434', fetchImpl),
    /currently in use/,
  )
})
