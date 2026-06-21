import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSkillFile, serializeSkillFile, sanitizeSkillFileForStrictYaml } from '../../../src/identity/continuity/skills/frontmatter.js'

test('sanitizeSkillFileForStrictYaml quotes colon-y values, preserves unknown keys, leaves the body', () => {
  const src = [
    '---',
    'name: media-dl',
    'description: Download media in one shot: mp4, mp3, gif',
    'allowed-tools: Bash, Read',
    'visibility: public',
    '---',
    '',
    'body line: stays as-is',
    '',
  ].join('\n')
  const out = sanitizeSkillFileForStrictYaml(src)
  assert.match(out, /description: "Download media in one shot: mp4, mp3, gif"/)
  assert.match(out, /allowed-tools: "Bash, Read"/)
  assert.match(out, /name: "media-dl"/)
  assert.match(out, /^body line: stays as-is$/m)
  assert.equal(parseSkillFile(out).frontmatter.description, 'Download media in one shot: mp4, mp3, gif')
})

test('sanitizeSkillFileForStrictYaml leaves a multi-line plain scalar valid (does not strand its continuation)', () => {
  const src = [
    '---',
    'name: demo',
    'description: line one',
    '  line two continues the scalar',
    'visibility: public',
    '---',
    '',
    'body',
    '',
  ].join('\n')
  const out = sanitizeSkillFileForStrictYaml(src)
  assert.match(out, /^description: line one$/m)
  assert.match(out, /^  line two continues the scalar$/m)
  assert.match(out, /visibility: "public"/)
})

test('sanitizeSkillFileForStrictYaml leaves block-scalar content lines verbatim (no corruption)', () => {
  const src = [
    '---',
    'name: demo',
    'description: |',
    '  summary: a colon here',
    '  detail: more',
    'visibility: public',
    '---',
    '',
    'body',
    '',
  ].join('\n')
  const out = sanitizeSkillFileForStrictYaml(src)
  assert.match(out, /^  summary: a colon here$/m)
  assert.match(out, /^  detail: more$/m)
  assert.match(out, /visibility: "public"/)
})

test('serializeSkillFile emits strict-valid quoted YAML and round-trips through parseSkillFile', () => {
  const frontmatter = {
    name: 'vscode-setup',
    description: 'Set up VS Code in one shot: apply my "Preferences Dark" theme',
    visibility: 'public' as const,
    tags: ['vscode', 'setup'],
  }
  const out = serializeSkillFile(frontmatter, 'body text\n')
  assert.match(out, /description: "Set up VS Code in one shot: apply my \\"Preferences Dark\\" theme"/)
  const parsed = parseSkillFile(out)
  assert.equal(parsed.frontmatter.name, frontmatter.name)
  assert.equal(parsed.frontmatter.description, frontmatter.description)
  assert.equal(parsed.frontmatter.visibility, 'public')
  assert.deepEqual(parsed.frontmatter.tags, frontmatter.tags)
  assert.equal(parsed.body, 'body text')
})

test('serializeSkillFile escapes control characters so a strict YAML parser stays happy', () => {
  const out = serializeSkillFile({ name: 'x', description: 'a\fb\x07c\x1bd\x7fe' }, '')
  assert.doesNotMatch(out, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
  assert.match(out, /\\x0C/)
  assert.match(out, /\\x07/)
  assert.match(out, /\\x1B/)
  assert.match(out, /\\x7F/)
})

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

test('keeps a colon inside an unquoted value verbatim', () => {
  const content = [
    '---',
    'name: t',
    'description: Use this skill when: committing changes',
    'when_to_use: trigger: on commit',
    '---',
    'body',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.description, 'Use this skill when: committing changes')
  assert.equal(parsed.frontmatter.whenToUse, 'trigger: on commit')
})

test('keeps a value that starts with a reserved character verbatim', () => {
  const content = [
    '---',
    'name: t',
    'description: @mention and `code` stay literal',
    '---',
    'body',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.description, '@mention and `code` stay literal')
})

test('a duplicated key takes the last value', () => {
  const content = [
    '---',
    'name: first',
    'name: second',
    '---',
    'body',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.name, 'second')
})

test('preserves version string formatting (no numeric coercion)', () => {
  const content = [
    '---',
    'name: t',
    'version: 1.0',
    '---',
    'body',
  ].join('\n')
  const parsed = parseSkillFile(content)
  assert.equal(parsed.frontmatter.version, '1.0')
})
