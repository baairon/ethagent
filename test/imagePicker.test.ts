import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { openImageFilePicker } from '../src/identity/profile/imagePicker.js'

test('image picker returns the selected file from the native picker', async () => {
  const result = await openImageFilePicker({
    platform: 'darwin',
    spawnImpl: fakeSpawn('/tmp/agent.png\n'),
  })

  assert.deepEqual(result, {
    ok: true,
    file: '/tmp/agent.png',
    method: 'macOS file picker',
  })
})

test('image picker reports cancellation without treating it as a crash', async () => {
  const result = await openImageFilePicker({
    platform: 'darwin',
    spawnImpl: fakeSpawn('', 1, 'User canceled.'),
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.cancelled, true)
    assert.match(result.error, /cancelled/)
  }
})

test('image picker gives a manual-path fallback when linux dialogs are unavailable', async () => {
  const result = await openImageFilePicker({
    platform: 'linux',
    env: { PATH: '' },
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.cancelled, false)
    assert.match(result.error, /enter the image path manually/)
  }
})

function fakeSpawn(stdoutText: string, code = 0, stderrText = ''): typeof spawn {
  return ((_cmd: string, _args: readonly string[]) => {
    const child = new EventEmitter() as ReturnType<typeof spawn>
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    ;(child as unknown as { stdout: PassThrough }).stdout = stdout
    ;(child as unknown as { stderr: PassThrough }).stderr = stderr
    ;(child as unknown as { kill: () => boolean }).kill = () => true
    queueMicrotask(() => {
      stdout.write(stdoutText)
      stderr.write(stderrText)
      stdout.end()
      stderr.end()
      child.emit('close', code)
    })
    return child
  }) as typeof spawn
}
