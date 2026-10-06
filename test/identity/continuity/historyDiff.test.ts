import test from 'node:test'
import assert from 'node:assert/strict'
import { diffLines, markdownHeadingFor, renderUnifiedPatch } from '../../../src/identity/continuity/diff/lineDiff.js'
import { diffMarkdownSections, parseMarkdownSections } from '../../../src/identity/continuity/diff/markdownDiff.js'
import { diffJson } from '../../../src/identity/continuity/diff/jsonDiff.js'
import { diffTrees } from '../../../src/identity/continuity/diff/treeDiff.js'

const enc = (text: string): Uint8Array => Buffer.from(text, 'utf8')

function rebuild(text: string, other: string): { a: string; b: string } {
  const lines = diffLines(text, other, { context: 100000 }).hunks.flatMap(hunk => hunk.lines)
  const join = (keep: (op: string) => boolean): string =>
    lines.filter(line => keep(line.op)).map(line => line.text + (line.noNewline ? '' : '\n')).join('')
  return { a: join(op => op !== '+'), b: join(op => op !== '-') }
}

test('line diff hunks rebuild both sides exactly, including CRLF and a missing final newline', () => {
  const cases: Array<[string, string]> = [
    ['a\nb\nc\n', 'a\nB\nc\nd'],
    ['x\r\ny\r\n', 'x\r\nz\r\n'],
    ['', 'new\n'],
    ['only\n', ''],
    ['same', 'same\n'],
  ]
  for (const [a, b] of cases) assert.deepEqual(rebuild(a, b), { a, b })
})

test('line diff labels hunks with the enclosing Markdown heading and marks missing newlines', () => {
  const a = '# M\n\n## Rules\n- A: one\n- B: two\n'
  const b = '# M\n\n## Rules\n- A: one\n- B: TWO'
  const diff = diffLines(a, b, { headingFor: markdownHeadingFor })
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.equal(diff.hunks[0]!.heading, '## Rules')
  const patch = renderUnifiedPatch(diff, { a: 'a/M', b: 'b/M' })
  assert.match(patch, /@@ .* @@ ## Rules/)
  assert.match(patch, /\\ No newline at end of file/)
})

test('line diff falls back to a whole-file replacement past the edit-distance cap', () => {
  const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n') + '\n'
  const b = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n') + '\n'
  const diff = diffLines(a, b, { maxD: 10 })
  assert.equal(diff.replaced, true)
  assert.equal(diff.added, 50)
  assert.equal(diff.removed, 50)
})

test('markdown diff reports labeled bullets added, removed, and modified per section', () => {
  const a = '# MEMORY.md\n\n## Rules\n- Git approval: ask first.\n- Old rule: gone soon.\n\n## Prefs\n- Tone: calm.\n'
  const b = '# MEMORY.md\n\n## Rules\n- Git approval: ask first, every time.\n- New rule: added.\n\n## Projects\n- torlink: client.\n'
  const changes = diffMarkdownSections(a, b)
  const rules = changes.find(change => change.section === 'MEMORY.md > Rules')!
  assert.equal(rules.change, 'modified')
  assert.deepEqual(rules.modified.map(item => item.label), ['Git approval'])
  assert.deepEqual(rules.added, ['- New rule: added.'])
  assert.deepEqual(rules.removed, ['- Old rule: gone soon.'])
  assert.equal(changes.find(change => change.section === 'MEMORY.md > Projects')!.change, 'added')
  assert.equal(changes.find(change => change.section === 'MEMORY.md > Prefs')!.change, 'removed')
})

test('markdown parser keeps sub-bullets with their parent and ignores headings in code fences', () => {
  const sections = parseMarkdownSections('## A\n- Rule: x\n  - detail\n```\n# not a heading\n```\n')
  assert.equal(sections.length, 1)
  assert.equal(sections[0]!.items[0]!.text, '- Rule: x\n  - detail\n```\n# not a heading\n```')
})

test('json diff keys arrays of objects by name or id', () => {
  const a = { skills: [{ id: 'a', description: 'one' }, { id: 'b', description: 'two' }] }
  const b = { skills: [{ id: 'b', description: 'TWO' }, { id: 'c', description: 'three' }] }
  const changes = diffJson(a, b)
  assert.deepEqual(changes.map(change => `${change.change} ${change.path}`).sort(), [
    'added /skills[id=c]',
    'modified /skills[id=b]/description',
    'removed /skills[id=a]',
  ])
})

test('tree diff compares bytes exactly and flags line-ending-only changes and binary files', () => {
  const a = { 'SOUL.md': enc('a\nb\n'), 'MEMORY.md': enc('same\n'), 'skills/x/SKILL.md': enc('x\n'), 'skills/x/blob.bin': Uint8Array.from([0, 1, 2]) }
  const b = { 'SOUL.md': enc('a\r\nb\r\n'), 'MEMORY.md': enc('same\n'), 'skills/y/SKILL.md': enc('y\n'), 'skills/x/blob.bin': Uint8Array.from([0, 1, 3]) }
  const diff = diffTrees(a, b)
  assert.equal(diff.identical, false)
  assert.equal(diff.summary.files.identical, 1)
  assert.equal(diff.files.find(file => file.path === 'SOUL.md')!.eolOnly, true)
  assert.equal(diff.files.find(file => file.path === 'skills/x/blob.bin')!.binary, true)
  assert.deepEqual(diff.skills.map(skill => `${skill.skill}:${skill.change}`).sort(), ['x:modified', 'y:added'])
  assert.equal(diffTrees(a, a).identical, true)
})
