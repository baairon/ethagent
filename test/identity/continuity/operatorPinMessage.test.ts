import test from 'node:test'
import assert from 'node:assert/strict'
import { operatorPinCompletionMessage } from '../../../src/identity/manager/continuity/vault.js'

test('operatorPinCompletionMessage: a plain snapshot save (no profile edits) talks about the pointer, not profile', () => {
  assert.match(operatorPinCompletionMessage(undefined), /rotate the onchain pointer/)
  assert.doesNotMatch(operatorPinCompletionMessage(undefined), /profile changes/)
  assert.match(operatorPinCompletionMessage({}), /rotate the onchain pointer/)
})

test('operatorPinCompletionMessage: an actual ENS edit talks about ENS', () => {
  assert.match(operatorPinCompletionMessage({ ensName: 'me.eth' }), /ENS changes discoverable/)
})

test('operatorPinCompletionMessage: an actual profile edit talks about profile changes', () => {
  assert.match(operatorPinCompletionMessage({ imagePath: '/tmp/avatar.png' }), /profile changes discoverable/)
  assert.match(operatorPinCompletionMessage({ name: 'New Name' }), /profile changes discoverable/)
  assert.match(operatorPinCompletionMessage({ description: 'New desc' }), /profile changes discoverable/)
})
