import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  collapseImagePathsToRefs,
  hasImageBlocks,
  ImageLoadError,
  loadImageBlock,
  modelSupportsImages,
  parseImageMarkers,
  userTextToContentBlocks,
} from '../../src/utils/images.js'
import type { ImageBlock } from '../../src/providers/contracts.js'

test('parseImageMarkers treats angle-bracket placeholder as plain text', () => {
  const blocks = parseImageMarkers('hello [image: <saved-path>] world')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.type, 'text')
  assert.equal((blocks[0] as { text: string }).text, 'hello [image: <saved-path>] world')
})

test('parseImageMarkers treats #N symbolic refs as plain text', () => {
  const blocks = parseImageMarkers('look at [image: #1] please')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.type, 'text')
  assert.equal((blocks[0] as { text: string }).text, 'look at [image: #1] please')
})

test('loadImageBlock rejects bare #N marker with ImageLoadError', async () => {
  await assert.rejects(
    loadImageBlock({ type: 'image', path: '#1' }),
    (err: unknown) => err instanceof ImageLoadError && /placeholder/.test((err as Error).message),
  )
})

test('parseImageMarkers extracts real-looking path into image block', () => {
  const blocks = parseImageMarkers('before [image: C:/users/me/foo.png] after')
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0]?.type, 'text')
  assert.equal(blocks[1]?.type, 'image')
  assert.equal((blocks[1] as ImageBlock).path, 'C:/users/me/foo.png')
  assert.equal(blocks[2]?.type, 'text')
})

test('userTextToContentBlocks returns string when no image markers exist', () => {
  const result = userTextToContentBlocks('just text, nothing else')
  assert.equal(typeof result, 'string')
  assert.equal(result, 'just text, nothing else')
})

test('userTextToContentBlocks returns blocks when an image marker is present', () => {
  const result = userTextToContentBlocks('look at [image: /tmp/x.png]')
  assert.ok(Array.isArray(result))
})

test('hasImageBlocks detects image blocks in messages', () => {
  assert.equal(hasImageBlocks([{ role: 'user', content: 'hello' }]), false)
  assert.equal(hasImageBlocks([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]), false)
  assert.equal(hasImageBlocks([{ role: 'user', content: [{ type: 'image', path: '/a.png' }] }]), true)
})

test('loadImageBlock rejects empty path with ImageLoadError', async () => {
  await assert.rejects(loadImageBlock({ type: 'image', path: '' }), ImageLoadError)
})

test('loadImageBlock rejects angle-bracket placeholder path with ImageLoadError', async () => {
  await assert.rejects(
    loadImageBlock({ type: 'image', path: '<saved-path>' }),
    (err: unknown) => err instanceof ImageLoadError && /placeholder/.test((err as Error).message),
  )
})

test('loadImageBlock surfaces ImageLoadError for missing file rather than raw ENOENT', async () => {
  const missing = path.join(os.tmpdir(), `ethagent-missing-${Date.now()}.png`)
  await assert.rejects(
    loadImageBlock({ type: 'image', path: missing }),
    (err: unknown) => err instanceof ImageLoadError && /not found/.test((err as Error).message),
  )
})

test('loadImageBlock reads real file and base64-encodes it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-img-'))
  const file = path.join(dir, 'tiny.png')
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452', 'hex')
  await fs.writeFile(file, png)
  try {
    const loaded = await loadImageBlock({ type: 'image', path: file })
    assert.equal(loaded.mimeType, 'image/png')
    assert.equal(loaded.dataBase64, png.toString('base64'))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('loadImageBlock returns block unchanged when dataBase64 + mimeType already set', async () => {
  const block: ImageBlock = { type: 'image', path: 'irrelevant', mimeType: 'image/png', dataBase64: 'AAAA' }
  const loaded = await loadImageBlock(block)
  assert.equal(loaded, block)
})

test('collapseImagePathsToRefs replaces real paths with sequential refs', () => {
  const out = collapseImagePathsToRefs('look at [image: C:/users/me/a.png] and [image: /tmp/b.png] together')
  assert.equal(out, 'look at [Image #1] and [Image #2] together')
})

test('collapseImagePathsToRefs leaves #N markers alone', () => {
  const out = collapseImagePathsToRefs('have [image: #5] keep its number')
  assert.equal(out, 'have [image: #5] keep its number')
})

test('collapseImagePathsToRefs leaves angle-bracket placeholders alone', () => {
  const out = collapseImagePathsToRefs('typo [image: <saved-path>] here')
  assert.equal(out, 'typo [image: <saved-path>] here')
})

test('collapseImagePathsToRefs is a no-op on text with no markers', () => {
  assert.equal(collapseImagePathsToRefs('just words'), 'just words')
})

test('modelSupportsImages distinguishes vision-capable models per cloud provider', () => {
  assert.equal(modelSupportsImages('anthropic', 'claude-sonnet-4-20250514'), true)
  assert.equal(modelSupportsImages('anthropic', 'claude-instant-1'), false)
  assert.equal(modelSupportsImages('gemini', 'gemini-2.5-pro'), true)
  assert.equal(modelSupportsImages('gemini', 'gemini-1.0-pro'), false)
  assert.equal(modelSupportsImages('openai', 'gpt-4o'), true)
  assert.equal(modelSupportsImages('openai', 'gpt-5'), true)
  assert.equal(modelSupportsImages('openai', 'gpt-3.5-turbo'), false)
  assert.equal(modelSupportsImages('unknown', 'whatever'), false)
})

test('modelSupportsImages gates llamacpp on mmprojPath, not model name', () => {
  assert.equal(modelSupportsImages('llamacpp', 'llava-1.6-mistral-7b.Q4_K_M.gguf'), false)
  assert.equal(modelSupportsImages('llamacpp', 'llava-1.6-mistral-7b.Q4_K_M.gguf', { mmprojPath: '/models/mmproj.gguf' }), true)
  assert.equal(modelSupportsImages('llamacpp', 'qwen3.5-9b-uncensored.gguf', { mmprojPath: '' }), false)
  assert.equal(modelSupportsImages('llamacpp', 'qwen3.5-9b-uncensored.gguf', { mmprojPath: '/x.gguf' }), true)
})

test('user message with image marker round-trips through session persistence', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-rt-'))
  const file = path.join(dir, 'pic.png')
  await fs.writeFile(file, Buffer.from('89504E470D0A1A0A', 'hex'))
  try {
    const userText = `here is a screenshot [image: ${file}] please review`
    const parsed = userTextToContentBlocks(userText)
    assert.ok(Array.isArray(parsed))
    const imageBlock = (parsed as Array<{ type: string }>).find(b => b.type === 'image') as ImageBlock | undefined
    assert.ok(imageBlock)
    assert.equal(imageBlock.path, file)
    const loaded = await loadImageBlock(imageBlock)
    assert.ok(loaded.dataBase64)
    assert.equal(loaded.mimeType, 'image/png')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
