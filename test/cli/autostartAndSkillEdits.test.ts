import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { installAutostart, renderPwshHookBlock, renderShellHookBlock, shellProfilePaths, uninstallAutostart } from '../../src/cli/autostart.js'
import { makeInstructionFileAdapter } from '../../src/cli/syncAdapters/instructionFileAdapter.js'
import type { SkillIndexEntry } from '../../src/identity/continuity/skills/types.js'

test('the POSIX shell hook launches --ensure-daemon in the background', () => {
  const block = renderShellHookBlock('/usr/bin/node', '/opt/ethagent/bin/ethagent.js')
  assert.match(block, /\/usr\/bin\/node/)
  assert.match(block, /ethagent\.js/)
  assert.match(block, /--ensure-daemon/)
  assert.match(block, /# >>> ethagent autosync >>>/)
  assert.match(block, /# <<< ethagent autosync <<</)
  assert.match(block, /& \)$/m) // backgrounded so it never blocks the prompt
})

test('the PowerShell hook launches --ensure-daemon with no console window (no flash)', () => {
  const block = renderPwshHookBlock('C:\\node.exe', 'C:\\ethagent\\bin\\ethagent.js')
  assert.match(block, /node\.exe/)
  assert.match(block, /ethagent\.js/)
  assert.match(block, /--ensure-daemon/)
  assert.match(block, /CreateNoWindow = \$true/)
  assert.match(block, /UseShellExecute = \$false/)
  assert.doesNotMatch(block, /Start-Process/) // Start-Process can flash a console; we avoid it
})

test('installAutostart writes an idempotent, removable shell hook', async () => {
  await withHome(async () => {
    assert.equal(installAutostart().installed, true)
    const present = shellProfilePaths().filter(f => hasNeedle(f, '--ensure-daemon'))
    assert.ok(present.length >= 1, 'at least one profile should carry the hook')

    const firstContent = readFileSync(present[0]!, 'utf8')
    installAutostart() // re-running must not duplicate the block
    const secondContent = readFileSync(present[0]!, 'utf8')
    assert.equal(secondContent, firstContent)
    assert.equal((secondContent.match(/# >>> ethagent autosync >>>/g) ?? []).length, 1)

    uninstallAutostart()
    assert.equal(hasNeedle(present[0]!, '--ensure-daemon'), false)
  })
})

test('installAutostart preserves existing profile content around the hook', async () => {
  await withHome(async () => {
    const file = shellProfilePaths()[0]!
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'export PATH="$PATH:/custom"\n', 'utf8')

    installAutostart()
    assert.match(readFileSync(file, 'utf8'), /export PATH="\$PATH:\/custom"/)

    uninstallAutostart()
    const after = readFileSync(file, 'utf8')
    assert.match(after, /export PATH="\$PATH:\/custom"/)
    assert.doesNotMatch(after, /ethagent autosync/)
  })
})

test('a harness edit to the skill section is preserved before the next mirror overwrites it', async () => {
  await withHome(async home => {
    const file = path.join(home, '.tool', 'INSTRUCTIONS.md')
    const skillPath = path.join(home, 'skill.md')
    await fs.writeFile(skillPath, '---\nname: demo\ndescription: A demo skill\n---\noriginal skill body\n', 'utf8')
    const skill: SkillIndexEntry = {
      name: 'demo',
      description: 'A demo skill',
      visibility: 'public',
      relativePath: 'demo/SKILL.md',
      absolutePath: skillPath,
    }
    const adapter = makeInstructionFileAdapter({ name: 'tool', description: 'test harness', filePath: () => file, detect: async () => true })
    const ctx = { soul: '# SOUL.md\n\nsoul\n', memory: '# MEMORY.md\n\nmemory\n' }
    const editsDir = path.join(home, '.ethagent', 'skill-edits')

    await adapter.mirror([skill], ctx) // first write + record state
    assert.equal(await countFiles(editsDir), 0)

    // The harness agent edits the skill body inside the instruction file.
    const edited = (await fs.readFile(file, 'utf8')).replace('original skill body', 'agent edited this skill')
    await fs.writeFile(file, edited, 'utf8')

    await adapter.mirror([skill], ctx) // overwrites, but must preserve the edit first
    assert.equal(await countFiles(editsDir), 1)
    const backups = await fs.readdir(editsDir)
    assert.match(await fs.readFile(path.join(editsDir, backups[0]!), 'utf8'), /agent edited this skill/)

    await adapter.mirror([skill], ctx) // nothing changed since -> no new backup
    assert.equal(await countFiles(editsDir), 1)
  })
})

test('shellProfilePaths targets the OneDrive Documents profile when redirected (Windows)', () => {
  if (process.platform !== 'win32') {
    assert.ok(shellProfilePaths().some(p => p.endsWith('.bashrc'))) // posix: shell rc files, no OneDrive logic
    return
  }
  const prev = process.env.OneDrive
  process.env.OneDrive = 'C:\\Users\\test\\OneDrive'
  try {
    const paths = shellProfilePaths()
    assert.ok(paths.some(p => p.includes('OneDrive') && p.endsWith('Microsoft.PowerShell_profile.ps1')))
  } finally {
    if (prev === undefined) delete process.env.OneDrive
    else process.env.OneDrive = prev
  }
})

function hasNeedle(file: string, needle: string): boolean {
  try {
    return readFileSync(file, 'utf8').includes(needle)
  } catch {
    return false
  }
}

test('an instruction-file harness gets the full skill folder (scripts) mirrored beside its instructions file, and cleanup removes it', async () => {
  await withHome(async home => {
    const file = path.join(home, '.tool', 'AGENTS.md')
    // A realistic vault skill folder that bundles a script the skill body refers to.
    const vaultSkillDir = path.join(home, 'vault', 'media-dl')
    await fs.mkdir(path.join(vaultSkillDir, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(vaultSkillDir, 'SKILL.md'), '---\nname: media-dl\ndescription: download media\n---\nrun scripts/download_media.py\n', 'utf8')
    await fs.writeFile(path.join(vaultSkillDir, 'scripts', 'download_media.py'), 'print("hi")\n', 'utf8')
    const skill: SkillIndexEntry = {
      name: 'media-dl',
      description: 'download media',
      visibility: 'public',
      relativePath: 'media-dl/SKILL.md',
      absolutePath: path.join(vaultSkillDir, 'SKILL.md'),
    }
    const adapter = makeInstructionFileAdapter({ name: 'tool', description: 't', filePath: () => file, detect: async () => true })

    await adapter.mirror([skill], { soul: '# SOUL.md\n\ns\n', memory: '# MEMORY.md\n\nm\n' })

    // The bundled script lands on disk next to the instructions file, where the agent can run it.
    const mirroredScript = path.join(home, '.tool', 'skills', 'media-dl', 'scripts', 'download_media.py')
    assert.equal(await readable(mirroredScript), true)
    const agentsMd = await fs.readFile(file, 'utf8')
    assert.match(agentsMd, /\.tool[\\/]skills/) // guidance points at the mirrored skills folder
    assert.match(agentsMd, /download media/) // the skill is still inlined for the agent to read

    // cleanup removes the mirror, never the vault source.
    await adapter.cleanup?.()
    assert.equal(await readable(mirroredScript), false)
    assert.equal(await readable(path.join(vaultSkillDir, 'scripts', 'download_media.py')), true)
  })
})

async function readable(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function countFiles(dir: string): Promise<number> {
  try {
    return (await fs.readdir(dir)).length
  } catch {
    return 0
  }
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-autostart-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn(home)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    await fs.rm(home, { recursive: true, force: true })
  }
}
