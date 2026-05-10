import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAgentIconReference } from '../../../../src/identity/profile/agentIcon.js'

test('agent icon validation accepts supported URLs and local media paths by extension', () => {
  assert.equal(validateAgentIconReference('https://example.com/icon.png'), null)
  assert.equal(validateAgentIconReference('ipfs://bafy/icon.svg'), null)
  assert.equal(validateAgentIconReference('C:\\tmp\\agent.mov'), null)
  assert.match(validateAgentIconReference('http://example.com/icon.png') ?? '', /local path, https/)
  assert.match(validateAgentIconReference('ipns://agent.example/icon.webm') ?? '', /local path, https/)
  assert.match(validateAgentIconReference('ftp://example.com/icon.png') ?? '', /local path, https/)
  assert.match(validateAgentIconReference('https://example.com/icon.txt') ?? '', /png, jpg/)
})
