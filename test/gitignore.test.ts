import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('root identity markdown files are ignored without hiding nested docs', () => {
  const lines = readFileSync('.gitignore', 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const entry of ['/SOUL.md', '/MEMORY.md', '/SKILLS.md']) {
    assert.ok(lines.includes(entry), `${entry} should be ignored at the repo root`)
  }

  for (const broadEntry of ['SOUL.md', 'MEMORY.md', 'SKILLS.md']) {
    assert.equal(lines.includes(broadEntry), false, `${broadEntry} should not ignore nested docs`)
  }
})
