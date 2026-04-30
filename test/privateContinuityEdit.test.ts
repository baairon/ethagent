import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeToolWithPermissions } from '../src/runtime/toolExecution.js'
import type { PermissionRequest } from '../src/tools/contracts.js'
import { permissionOptionsForRequest } from '../src/chat/PermissionPrompt.js'
import {
  continuityVaultRef,
  readContinuityFiles,
  writeContinuityFiles,
} from '../src/identity/continuity/storage.js'
import { listPrivateContinuityHistory } from '../src/identity/continuity/history.js'
import {
  listRewindEntries,
} from '../src/storage/rewind.js'
import type { EthagentConfig, EthagentIdentity } from '../src/storage/config.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  chainId: 1,
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
  agentId: '42',
  agentUri: 'ipfs://bafy-agent',
}

const config: EthagentConfig = {
  version: 1,
  provider: 'openai',
  model: 'gpt-test',
  firstRunAt: new Date(0).toISOString(),
  identity,
}

test('private continuity edit prompts in accept-edits and exposes diff data', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
    let prompts = 0
    let seenRequest: PermissionRequest | undefined

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        oldText: 'private memory',
        newText: 'approved memory',
      },
      permissionMode: 'accept-edits',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [{ kind: 'edit', scope: 'kind' }],
      requestPermission: async request => {
        prompts += 1
        seenRequest = request
        return 'deny'
      },
      onDirectoryChange: () => {},
    })

    assert.equal(prompts, 1)
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.summary, 'propose_private_continuity_edit denied')
    assert.equal(seenRequest?.kind, 'private-continuity-edit')
    if (seenRequest?.kind !== 'private-continuity-edit') throw new Error('expected private continuity request')
    assert.equal(seenRequest.file, 'MEMORY.md')
    assert.match(seenRequest.diff, /-private memory/)
    assert.match(seenRequest.diff, /\+approved memory/)
    assert.doesNotMatch(seenRequest.diff, /^-# Memory/m)
    assert.doesNotMatch(seenRequest.diff, /^\+# Memory/m)
    assert.deepEqual(permissionOptionsForRequest(seenRequest).map(option => option.value), ['allow-once', 'deny'])
    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
  })
})

test('private continuity read prompts and ensures missing vault scaffolds are readable', async () => {
  await withHome(async () => {
    let prompts = 0
    let seenRequest: PermissionRequest | undefined

    const outcome = await executeToolWithPermissions({
      name: 'read_private_continuity_file',
      input: {
        file: 'MEMORY.md',
        startLine: 1,
        endLine: 20,
      },
      permissionMode: 'accept-edits',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [{ kind: 'read', scope: 'kind' }],
      requestPermission: async request => {
        prompts += 1
        seenRequest = request
        return 'allow-once'
      },
      onDirectoryChange: () => {},
    })

    assert.equal(prompts, 0)
    assert.equal(outcome.result.ok, true)
    assert.equal(outcome.sessionRule, undefined)
    assert.equal(outcome.persistRule, false)
    assert.match(outcome.result.content, /1: # .* Memory/)
    assert.match(outcome.result.content, /Durable User Preferences/)
    assert.equal(seenRequest, undefined)

    await fs.access(continuityVaultRef(identity).memoryPath)
  })
})

test('workspace read_file refuses private continuity markdown when identity is linked', async () => {
  await withHome(async () => {
    let prompts = 0
    const outcome = await executeToolWithPermissions({
      name: 'read_file',
      input: { path: 'MEMORY.md' },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => {
        prompts += 1
        return 'allow-once'
      },
      onDirectoryChange: () => {},
    })

    assert.equal(prompts, 0)
    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.summary, 'read_file failed before execution')
    assert.match(outcome.result.content, /read_private_continuity_file/)
  })
})

test('approved private continuity edit updates only the local working markdown file', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'SOUL.md',
        oldText: 'private soul',
        newText: 'local soul note',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    assert.equal(outcome.sessionRule, undefined)
    assert.equal(outcome.persistRule, false)
    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Soul\nlocal soul note\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
  })
})

test('approved private continuity edit records identity history but no rewind checkpoint', async () => {
  await withHome(async () => {
    const originalMemory = '# Memory\n\n## Durable User Preferences\n\n- Original preference\n'
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': originalMemory,
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        appendToSection: 'Durable User Preferences',
        appendText: '- Identity history can restore private memory.',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    assert.match(outcome.result.content, /Saved private continuity/)
    assert.match(outcome.result.content, /previous version saved to private identity history/)
    assert.match(outcome.result.content, /`\/rewind` does not restore identity markdown/)
    assert.match(outcome.result.content, /Review file: `.*MEMORY\.md`/)
    assert.match(outcome.result.content, /Identity Hub > Memory and Persona/)
    assert.match(outcome.result.content, /Identity Hub > Snapshots/)
    assert.match((await readContinuityFiles(identity))['MEMORY.md'], /Identity history can restore private memory/)

    const history = await listPrivateContinuityHistory(identity)
    assert.equal(history.length, 1)
    assert.equal(history[0]?.file, 'MEMORY.md')
    assert.equal(history[0]?.previousContent, originalMemory)
    assert.match(history[0]?.filePath ?? '', /MEMORY\.md$/)

    const rewindEntries = await listRewindEntries(process.cwd(), { limit: 10 })
    assert.equal(rewindEntries.length, 0)
  })
})

test('approved private continuity append builds on an existing scaffold section', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\n\n## Persona\n\n- Existing persona\n',
      'MEMORY.md': '# Memory\n\n## Durable User Preferences\n\n- Existing preference\n\n## Boundaries\n\n- Keep public capabilities in SKILLS.md.\n',
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        appendToSection: 'Durable User Preferences',
        appendText: '- Prefers clean vs. base collision names.',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Soul\n\n## Persona\n\n- Existing persona\n',
      'MEMORY.md': [
        '# Memory',
        '',
        '## Durable User Preferences',
        '',
        '- Existing preference',
        '- Prefers clean vs. base collision names.',
        '',
        '## Boundaries',
        '',
        '- Keep public capabilities in SKILLS.md.',
      ].join('\n') + '\n',
    })
  })
})

test('private continuity append repairs legacy MEMORY scaffold before appending', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\n\n## Persona\n\n- Existing persona\n',
      'MEMORY.md': [
        '# Memory',
        '',
        '## Durable Context',
        '',
        '- Legacy durable context',
        '',
        '## Boundaries',
        '',
        '- Legacy boundary',
      ].join('\n') + '\n',
    })

    let seenRequest: PermissionRequest | undefined
    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        appendToSection: 'Durable User Preferences',
        appendText: '- Prefers explicit permission for identity memory edits.',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async request => {
        seenRequest = request
        return 'allow-once'
      },
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    assert.equal(outcome.result.summary, 'repair Durable User Preferences section and append to Durable User Preferences in MEMORY.md')
    if (seenRequest?.kind !== 'private-continuity-edit') throw new Error('expected private continuity request')
    assert.match(seenRequest.diff, /\+## Durable User Preferences/)
    assert.match(seenRequest.diff, /\+.*Prefers explicit permission/)
    assert.doesNotMatch(seenRequest.diff, /^-## Durable Context/m)
    assert.doesNotMatch(seenRequest.diff, /^\+## Boundaries/m)

    const memory = (await readContinuityFiles(identity))['MEMORY.md']
    assert.match(memory, /## Durable Context/)
    assert.match(memory, /## Durable User Preferences/)
    assert.match(memory, /Prefers explicit permission for identity memory edits/)
    assert.match(memory, /## Boundaries/)
    assert.ok(memory.indexOf('## Durable Context') < memory.indexOf('## Durable User Preferences'))
    assert.ok(memory.indexOf('## Durable User Preferences') < memory.indexOf('## Boundaries'))
  })
})

test('private continuity append repairs legacy SOUL scaffold before appending', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': [
        '# Soul',
        '',
        '## Identity',
        '',
        '- Legacy identity note',
        '',
        '## Private Continuity',
        '',
        '- Legacy private continuity',
      ].join('\n') + '\n',
      'MEMORY.md': '# Memory\n\n## Durable User Preferences\n\n- Existing preference\n',
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'SOUL.md',
        appendToSection: 'Persona',
        appendText: '- Uses a concise, direct engineering voice.',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    assert.equal(outcome.result.summary, 'repair Persona section and append to Persona in SOUL.md')
    const soul = (await readContinuityFiles(identity))['SOUL.md']
    assert.match(soul, /## Persona/)
    assert.match(soul, /Uses a concise, direct engineering voice/)
    assert.match(soul, /## Identity/)
    assert.match(soul, /## Private Continuity/)
  })
})

test('private continuity permission denial leaves repaired legacy scaffold unapplied', async () => {
  await withHome(async () => {
    const originalMemory = [
      '# Memory',
      '',
      '## Durable Context',
      '',
      '- Legacy durable context',
    ].join('\n') + '\n'
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\n\n## Persona\n\n- Existing persona\n',
      'MEMORY.md': originalMemory,
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        appendToSection: 'Durable User Preferences',
        appendText: '- Should not be written.',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'deny',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.summary, 'propose_private_continuity_edit denied')
    assert.equal((await readContinuityFiles(identity))['MEMORY.md'], originalMemory)
  })
})

test('private continuity append accepts local-model friendly aliases', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\n\n## Persona\n\n- Existing persona\n',
      'MEMORY.md': '# Memory\n\n## Durable User Preferences\n\n- Existing preference\n',
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'memory.md',
        section: 'Durable User Preferences',
        note: '- Prefers direct surgical memory edits.',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    const files = await readContinuityFiles(identity)
    assert.match(files['MEMORY.md'], /Prefers direct surgical memory edits/)
  })
})

test('private continuity repair hint tells local models not to search workspace files', async () => {
  const outcome = await executeToolWithPermissions({
    name: 'propose_private_continuity_edit',
    input: { file: 'MEMORY.md' },
    permissionMode: 'default',
    cwd: process.cwd(),
    config,
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })

  assert.equal(outcome.result.ok, false)
  assert.match(outcome.result.content, /resolves the identity vault path/)
  assert.match(outcome.result.content, /do not search workspace folders/)
  assert.match(outcome.result.content, /file-only input/)
})

test('private continuity edit rejects whole-file replacement', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        newText: '# Memory\nreplacement\n',
        replaceWholeFile: true,
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.summary, 'propose_private_continuity_edit rejected input')
    assert.match(outcome.result.content, /whole-file replacement is disabled/)
    assert.deepEqual(await readContinuityFiles(identity), {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })
  })
})

test('private continuity edit rejected empty input includes repair shape for local models', async () => {
  let prompts = 0
  const outcome = await executeToolWithPermissions({
    name: 'propose_private_continuity_edit',
    input: {},
    permissionMode: 'default',
    cwd: process.cwd(),
    config,
    getPermissionRules: () => [],
    requestPermission: async () => {
      prompts += 1
      return 'allow-once'
    },
    onDirectoryChange: () => {},
  })

  assert.equal(prompts, 0)
  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'propose_private_continuity_edit rejected input')
  assert.match(outcome.result.content, /missing required fields: file/)
  assert.match(outcome.result.content, /private continuity edit input requires `file` plus one complete edit mode/)
  assert.match(outcome.result.content, /"file":"MEMORY\.md"/)
  assert.match(outcome.result.content, /"appendToSection":"Durable User Preferences"/)
  assert.match(outcome.result.content, /Do not call propose_private_continuity_edit with empty input/)
})

test('private continuity edit rejects file-only input with explicit edit-mode guidance', async () => {
  const outcome = await executeToolWithPermissions({
    name: 'propose_private_continuity_edit',
    input: { file: 'MEMORY.md' },
    permissionMode: 'default',
    cwd: process.cwd(),
    config,
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'propose_private_continuity_edit rejected input')
  assert.match(outcome.result.content, /file alone is not enough/)
  assert.match(outcome.result.content, /appendToSection/)
  assert.match(outcome.result.content, /oldText\+newText/)
})

test('private continuity edit refuses when no active identity exists', async () => {
  let prompts = 0
  const outcome = await executeToolWithPermissions({
    name: 'propose_private_continuity_edit',
    input: { file: 'SOUL.md', oldText: '# Soul', newText: '# Soul\n' },
    permissionMode: 'default',
    cwd: process.cwd(),
    config: { version: 1, provider: 'openai', model: 'gpt-test', firstRunAt: new Date(0).toISOString() },
    getPermissionRules: () => [],
    requestPermission: async () => {
      prompts += 1
      return 'allow-once'
    },
    onDirectoryChange: () => {},
  })

  assert.equal(prompts, 0)
  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'propose_private_continuity_edit failed before execution')
  assert.match(outcome.result.content, /no active identity/i)
})

test('private continuity edit cannot create persistent permission rules', async () => {
  await withHome(async () => {
    await writeContinuityFiles(identity, {
      'SOUL.md': '# Soul\nprivate soul\n',
      'MEMORY.md': '# Memory\nprivate memory\n',
    })

    const outcome = await executeToolWithPermissions({
      name: 'propose_private_continuity_edit',
      input: {
        file: 'MEMORY.md',
        oldText: 'private memory',
        newText: 'private memory updated',
      },
      permissionMode: 'default',
      cwd: process.cwd(),
      config,
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-path-project',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, true)
    assert.equal(outcome.sessionRule, undefined)
    assert.equal(outcome.persistRule, false)
  })
})

async function withHome(fn: () => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-private-continuity-'))
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
