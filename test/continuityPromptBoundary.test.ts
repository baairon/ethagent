import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt } from '../src/runtime/systemPrompt.js'
import { buildBaseMessages } from '../src/chat/chatScreenUtils.js'
import type { EthagentConfig } from '../src/storage/config.js'

test('base system prompt does not auto-load continuity markdown files', () => {
  const prompt = buildSystemPrompt({
    cwd: process.cwd(),
    model: 'test-model',
    provider: 'openai',
    hasTools: true,
  })

  assert.equal(prompt.includes('SOUL.md'), false)
  assert.equal(prompt.includes('MEMORY.md'), false)
  assert.equal(prompt.includes('SKILLS.md'), false)
})

test('identity-linked prompt routes private continuity through scaffold edits', () => {
  const prompt = buildSystemPrompt({
    cwd: process.cwd(),
    model: 'test-model',
    provider: 'llamacpp',
    hasTools: true,
    hasIdentity: true,
  })

  assert.match(prompt, /SOUL\.md and MEMORY\.md are existing scaffolded private identity files/)
  assert.match(prompt, /SOUL\.md is the authoritative persona, voice, and standing-behavior layer/)
  assert.match(prompt, /not stored in plans\//)
  assert.match(prompt, /should not be discovered with workspace `list_directory` or `read_file`/)
  assert.match(prompt, /read_private_continuity_file/)
  assert.match(prompt, /propose_private_continuity_edit/)
  assert.match(prompt, /appendToSection.*appendText/)
  assert.match(prompt, /build on top of it/)
  assert.match(prompt, /do not search project folders/)
  assert.match(prompt, /never replace the whole file/i)
  assert.match(prompt, /never create a new file/)
  assert.match(prompt, /do NOT create, overwrite, or patch SOUL\.md\/MEMORY\.md with `write_file` or `edit_file`/)
})

test('base messages do not include continuity config or public skills metadata automatically', () => {
  const config: EthagentConfig = {
    version: 1,
    provider: 'openai',
    model: 'gpt-test',
    firstRunAt: new Date(0).toISOString(),
    identity: {
      source: 'erc8004',
      address: '0x000000000000000000000000000000000000dEaD',
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      agentId: '42',
      agentUri: 'ipfs://bafy-agent',
      state: {
        memory: 'private-memory-marker',
        soul: 'private-soul-marker',
      },
      backup: {
        cid: 'bafy-private-snapshot',
        createdAt: new Date(0).toISOString(),
        envelopeVersion: 'ethagent-continuity-snapshot-v1',
        ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
        status: 'pinned',
      },
      publicSkills: {
        cid: 'bafy-public-skills',
        agentCardCid: 'bafy-agent-card',
        status: 'pinned',
      },
    },
  }
  const serialized = JSON.stringify(buildBaseMessages([], config, true, process.cwd()))

  assert.equal(serialized.includes('private-memory-marker'), false)
  assert.equal(serialized.includes('private-soul-marker'), false)
  assert.equal(serialized.includes('bafy-private-snapshot'), false)
  assert.equal(serialized.includes('bafy-public-skills'), false)
  assert.equal(serialized.includes('bafy-agent-card'), false)
})
