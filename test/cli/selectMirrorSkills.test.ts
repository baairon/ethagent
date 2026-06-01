import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMirrorSkills } from '../../src/cli/sync.js'
import type { PublicSkill } from '../../src/cli/syncAdapters/shared.js'

function skill(name: string, visibility: 'public' | 'private', description: string): PublicSkill {
  return {
    name,
    description,
    visibility,
    relativePath: `${name}/SKILL.md`,
    absolutePath: `/vault/skills/${name}/SKILL.md`,
  }
}

test('selectMirrorSkills mirrors public AND private skills (it does not filter on visibility)', () => {
  const all = [
    skill('pub', 'public', 'a real public skill'),
    skill('priv', 'private', 'a real private skill'),
  ]
  const names = selectMirrorSkills(all).map(s => s.name).sort()
  assert.deepEqual(names, ['priv', 'pub'])
})

test('selectMirrorSkills drops draft/scaffold skills regardless of visibility', () => {
  const all = [
    skill('ready', 'private', 'a finished description'),
    skill('empty', 'private', ''),
    skill('placeholder', 'public', '<one-line public description before publishing>'),
    skill('selfnamed', 'private', 'selfnamed'),
  ]
  const names = selectMirrorSkills(all).map(s => s.name)
  assert.deepEqual(names, ['ready'])
})
