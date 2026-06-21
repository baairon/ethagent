import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { isSyncWorthyChange, keyPath } from '../../src/cli/watch.js'

const vault = path.join(os.tmpdir(), 'ethagent-vault')
const claudeDir = path.join(os.homedir(), '.claude')
const codexDir = path.join(os.homedir(), '.codex')
const sourceKeys = [keyPath(vault)]
const fileKeys = new Set([
  keyPath(path.join(claudeDir, 'CLAUDE.md')),
  keyPath(path.join(codexDir, 'AGENTS.md')),
])

test('harness churn under a watched root never triggers a sync (no storm)', () => {
  assert.equal(isSyncWorthyChange(claudeDir, path.join('sessions', 'abc.jsonl'), sourceKeys, fileKeys), false)
  assert.equal(isSyncWorthyChange(claudeDir, 'history.jsonl', sourceKeys, fileKeys), false)
  assert.equal(isSyncWorthyChange(claudeDir, 'settings.local.json', sourceKeys, fileKeys), false)
  assert.equal(isSyncWorthyChange(codexDir, 'logs_2.sqlite-wal', sourceKeys, fileKeys), false)
})

test('the harness skills-mirror output never triggers a sync (first-mirror does not self-fire)', () => {
  assert.equal(isSyncWorthyChange(claudeDir, path.join('skills', 'media-dl', 'SKILL.md'), sourceKeys, fileKeys), false)
  assert.equal(isSyncWorthyChange(claudeDir, path.join('skills', 'media-dl', 'scripts', 'dl.py'), sourceKeys, fileKeys), false)
})

test('a real edit to a managed instruction file triggers a sync', () => {
  assert.equal(isSyncWorthyChange(claudeDir, 'CLAUDE.md', sourceKeys, fileKeys), true)
  assert.equal(isSyncWorthyChange(codexDir, 'AGENTS.md', sourceKeys, fileKeys), true)
})

test('any change in the vault subtree triggers a sync (soul/memory and nested skills)', () => {
  assert.equal(isSyncWorthyChange(vault, 'SOUL.md', sourceKeys, fileKeys), true)
  assert.equal(isSyncWorthyChange(vault, 'MEMORY.md', sourceKeys, fileKeys), true)
  assert.equal(isSyncWorthyChange(vault, path.join('skills', 'x', 'SKILL.md'), sourceKeys, fileKeys), true)
})

test('dot-prefixed bookkeeping is ignored; an unknown filename is conservatively synced', () => {
  assert.equal(isSyncWorthyChange(vault, '.ethagent-sync.json', sourceKeys, fileKeys), false)
  assert.equal(isSyncWorthyChange(claudeDir, '.ethagent-mirror.json', sourceKeys, fileKeys), false)
  assert.equal(isSyncWorthyChange(vault, null, sourceKeys, fileKeys), true)
})
