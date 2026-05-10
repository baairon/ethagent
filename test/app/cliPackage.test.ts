import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('package bin prints help through the shipped entrypoint', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['bin/ethagent.js', '--help'], {
    timeout: 10_000,
  })

  assert.match(stdout, /ethagent: privacy-first AI agent/)
  assert.match(stdout, /ethagent --version/)
})

test('package bin prints version through the shipped entrypoint', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['bin/ethagent.js', '--version'], {
    timeout: 10_000,
  })

  assert.match(stdout.trim(), /^ethagent \d+\.\d+\.\d+/)
})
