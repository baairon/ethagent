import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSkillFile } from '../../../src/identity/continuity/skills/frontmatter.js'

test('parses supported frontmatter keys with quoted and bare scalars', () => {
  const content = [
    '---',
    'name: git:commit',
    'description: "Make a clean conventional commit"',
    'when_to_use: writing commits',
    'visibility: public',
    'tags: [git, commit, hygiene]',
    'argument-hint: <ticket>',
    '---',
    '',
    '# git:commit',
    'body content here',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.name, 'git:commit')
  assert.equal(parsed.frontmatter.description, 'Make a clean conventional commit')
  assert.equal(parsed.frontmatter.whenToUse, 'writing commits')
  assert.equal(parsed.frontmatter.visibility, 'public')
  assert.deepEqual(parsed.frontmatter.tags, ['git', 'commit', 'hygiene'])
  assert.equal(parsed.frontmatter.argumentHint, '<ticket>')
  assert.match(parsed.body, /# git:commit/)
  assert.match(parsed.body, /body content here/)
})

test('drops unsupported frontmatter keys silently', () => {
  const content = [
    '---',
    'name: writing:obit',
    'description: Draft obituary',
    'allowed-tools: [Bash]',
    'hooks: { Stop: cmd }',
    'shell: bash',
    'model: opus',
    '---',
    '',
    'body',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.name, 'writing:obit')
  assert.equal(parsed.frontmatter.description, 'Draft obituary')
  assert.ok(!('allowedTools' in parsed.frontmatter))
  assert.ok(!('hooks' in parsed.frontmatter))
})

test('files without frontmatter return empty metadata and full body', () => {
  const content = '# heading\n\nplain markdown\n'
  const parsed = parseSkillFile(content)
  assert.deepEqual(parsed.frontmatter, {})
  assert.equal(parsed.body, '# heading\n\nplain markdown')
})

test('visibility defaults are validated, invalid values are dropped', () => {
  const content = [
    '---',
    'name: test',
    'visibility: dangerous',
    '---',
    'body',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.visibility, undefined)
})

test('comma-separated tags without brackets are accepted', () => {
  const content = [
    '---',
    'name: t',
    'tags: a, b, c',
    '---',
    '',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.deepEqual(parsed.frontmatter.tags, ['a', 'b', 'c'])
})

test('does not interpret ${...} substitutions in body', () => {
  const content = [
    '---',
    'name: t',
    '---',
    'literal ${VAR} and ${CLAUDE_SKILL_DIR} should remain verbatim',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.match(parsed.body, /\$\{VAR\}/)
  assert.match(parsed.body, /\$\{CLAUDE_SKILL_DIR\}/)
})
