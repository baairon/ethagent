import test from 'node:test'
import assert from 'node:assert/strict'
import { executeToolWithPermissions } from '../../src/runtime/toolExecution.js'

test('run_bash rejects explanatory prose command input', async () => {
  const outcome = await executeToolWithPermissions({
    name: 'run_bash',
    input: { command: "You'll need to have Python installed on your system for this to run." },
    permissionMode: 'default',
    cwd: process.cwd(),
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'run_bash rejected input')
  assert.match(outcome.result.content, /actual shell command, not explanatory prose/i)
})

test('run_bash accepts a normal executable command', async () => {
  const outcome = await executeToolWithPermissions({
    name: 'run_bash',
    input: { command: 'python snake.py' },
    permissionMode: 'default',
    cwd: process.cwd(),
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })

  assert.equal(outcome.result.ok, false)
  assert.notEqual(outcome.result.summary, 'run_bash rejected input')
  assert.doesNotMatch(outcome.result.content, /actual shell command, not explanatory prose/i)
})

test('run_bash rejects native ethagent tool names before shell execution', async () => {
  for (const command of ['list_directory', 'read_file essay.txt', 'edit_file', 'change_directory ethagent-test']) {
    const outcome = await executeToolWithPermissions({
      name: 'run_bash',
      input: { command },
      permissionMode: 'default',
      cwd: process.cwd(),
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.summary, 'run_bash rejected input')
    assert.match(outcome.result.content, /not an ethagent tool name/i)
  }
})

test('run_bash rejects bare echo and printf used to emit conversational text', async () => {
  for (const command of ['echo "hello"', 'echo hello world', 'printf "hi\\n"']) {
    const outcome = await executeToolWithPermissions({
      name: 'run_bash',
      input: { command },
      permissionMode: 'default',
      cwd: process.cwd(),
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.equal(outcome.result.ok, false)
    assert.equal(outcome.result.summary, 'run_bash rejected input')
    assert.match(outcome.result.content, /reply directly in your assistant message/i)
  }
})

test('run_bash allows echo/printf with shell metacharacters', async () => {
  for (const command of ['echo $HOME', 'echo foo | wc -l', 'echo foo > /tmp/out.txt', 'printf "%s\\n" $USER']) {
    const outcome = await executeToolWithPermissions({
      name: 'run_bash',
      input: { command },
      permissionMode: 'default',
      cwd: process.cwd(),
      getPermissionRules: () => [],
      requestPermission: async () => 'allow-once',
      onDirectoryChange: () => {},
    })

    assert.notEqual(outcome.result.summary, 'run_bash rejected input')
    assert.doesNotMatch(outcome.result.content ?? '', /reply directly in your assistant message/i)
  }
})
