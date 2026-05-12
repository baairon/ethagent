import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeToolWithPermissions } from '../../src/runtime/toolExecution.js'
import type { PermissionRequest } from '../../src/tools/contracts.js'

test('workspace file write tools expose unified permission diffs', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-file-diff-'))
  await fs.writeFile(path.join(cwd, 'edit.txt'), 'before\nkeep\n', 'utf8')
  await fs.writeFile(path.join(cwd, 'delete.txt'), 'remove me\n', 'utf8')

  const editRequest = await capturePermissionRequest(cwd, 'edit_file', {
    path: 'edit.txt',
    oldText: 'before',
    newText: 'after',
  })
  const writeRequest = await capturePermissionRequest(cwd, 'write_file', {
    path: 'new.txt',
    content: 'created\n',
  })
  const deleteRequest = await capturePermissionRequest(cwd, 'delete_file', {
    path: 'delete.txt',
  })

  assert.equal(editRequest.kind, 'edit')
  assert.match(editRequest.diff, /--- edit\.txt/)
  assert.match(editRequest.diff, /^-before$/m)
  assert.match(editRequest.diff, /^\+after$/m)

  assert.equal(writeRequest.kind, 'write')
  assert.match(writeRequest.diff, /--- new\.txt/)
  assert.match(writeRequest.diff, /@@ -0,0 \+1 @@/)
  assert.match(writeRequest.diff, /^\+created$/m)

  assert.equal(deleteRequest.kind, 'delete')
  assert.match(deleteRequest.diff, /--- delete\.txt/)
  assert.match(deleteRequest.diff, /^-remove me$/m)
})

async function capturePermissionRequest(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
): Promise<PermissionRequest> {
  let seenRequest: PermissionRequest | undefined
  const outcome = await executeToolWithPermissions({
    name,
    input,
    permissionMode: 'default',
    cwd,
    getPermissionRules: () => [],
    requestPermission: async request => {
      seenRequest = request
      return 'deny'
    },
    onDirectoryChange: () => {},
  })

  assert.equal(outcome.result.ok, false)
  if (!seenRequest) throw new Error(`expected ${name} to request permission`)
  return seenRequest
}
