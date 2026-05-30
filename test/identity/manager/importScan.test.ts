import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extractOutsideManaged } from '../../../src/cli/syncAdapters/managedBlock.js'
import {
  isValuableImport,
  mergeImportedNotes,
  scanImportCandidates,
  type ImportCandidate,
} from '../../../src/identity/manager/create/importScan.js'

const RICH_CLAUDE_MD = [
  '# Global Rules',
  '',
  '## Persona',
  '- Name: Ale, computer science student who cares about sovereignty.',
  '- Communication: conversational and casual, lowercase by default.',
  '',
  '## Key Projects',
  '- ethagent: privacy-first AI agent with a portable Ethereum identity.',
  '- rodurite.com: decentralized escrow protocol on Ethereum smart contracts.',
  '',
  '## Boundaries',
  '- Do not store secrets unless explicitly asked.',
].join('\n')

test('extractOutsideManaged returns whole file when there are no markers', () => {
  assert.equal(extractOutsideManaged('my notes\n'), 'my notes')
})

test('extractOutsideManaged drops the ethagent managed block, keeps the rest', () => {
  const content = [
    'before block',
    '<!-- ethagent:start -->',
    'managed stuff',
    '<!-- ethagent:end -->',
    'after block',
  ].join('\n')
  assert.equal(extractOutsideManaged(content), 'before block\n\nafter block')
})

test('isValuableImport rejects empty and scaffold-only content', () => {
  assert.equal(isValuableImport(''), false)
  assert.equal(isValuableImport('# Just A Heading\n\n<!-- a comment -->'), false)
  const scaffold = [
    '## Persona',
    'The standing voice, collaboration style, and behavior this agent keeps across sessions and models.',
    '- Voice: <e.g., direct, concise, no filler>',
    '- Tone: <e.g., warm but professional>',
  ].join('\n')
  assert.equal(isValuableImport(scaffold), false)
})

test('isValuableImport accepts substantive real notes', () => {
  assert.equal(isValuableImport(RICH_CLAUDE_MD), true)
})

test('mergeImportedNotes appends a dated section to MEMORY.md and leaves SOUL.md untouched', () => {
  const base = {
    'SOUL.md': '# SOUL.md\n\n<!-- ethagent:identity:start -->\nid\n<!-- ethagent:identity:end -->\n\n## Persona\n',
    'MEMORY.md': '# MEMORY.md\n\n## Durable User Preferences\n',
  }
  const candidates: ImportCandidate[] = [{ source: 'CLAUDE.md', raw: 'imported note body', contentLines: 1 }]
  const merged = mergeImportedNotes(base, candidates, new Date('2026-05-29T00:00:00Z'))

  assert.equal(merged['SOUL.md'], base['SOUL.md'])
  assert.match(merged['MEMORY.md'], /^# MEMORY\.md/)
  assert.match(merged['MEMORY.md'], /## Durable User Preferences/)
  assert.match(merged['MEMORY.md'], /## Imported from CLAUDE\.md \(2026-05-29\)/)
  assert.match(merged['MEMORY.md'], /imported note body/)
})

test('mergeImportedNotes is a no-op with no candidates', () => {
  const base = { 'SOUL.md': '# SOUL.md\n', 'MEMORY.md': '# MEMORY.md\n' }
  assert.deepEqual(mergeImportedNotes(base, []), base)
})

test('scanImportCandidates detects a populated CLAUDE.md', async () => {
  await withHome(async () => {
    const claudeDir = path.join(os.homedir(), '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), `${RICH_CLAUDE_MD}\n`, 'utf8')

    const candidates = await scanImportCandidates()
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0]?.source, 'CLAUDE.md')
    assert.match(candidates[0]?.raw ?? '', /ethagent: privacy-first AI agent/)
  })
})

test('scanImportCandidates ignores ethagent-managed content and stays silent', async () => {
  await withHome(async () => {
    const claudeDir = path.join(os.homedir(), '.claude')
    await fs.mkdir(claudeDir, { recursive: true })
    const onlyManaged = [
      '<!-- ethagent:start -->',
      '<!-- ethagent:soul:start -->',
      'managed soul body for the current agent',
      '<!-- ethagent:soul:end -->',
      '<!-- ethagent:end -->',
    ].join('\n')
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), `${onlyManaged}\n`, 'utf8')

    const candidates = await scanImportCandidates()
    assert.deepEqual(candidates, [])
  })
})

async function withHome(fn: () => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-import-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn()
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    await fs.rm(home, { recursive: true, force: true })
  }
}
