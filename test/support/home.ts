import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { base32 } from '@scure/base'
import type { HistoryIo } from '../../src/cli/history/shared.js'

export async function withHome(fn: (home: string) => Promise<void>, cleanup?: () => void): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-test-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn(home)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    cleanup?.()
    await fs.rm(home, { recursive: true, force: true }).catch(() => null)
  }
}

export type CapturedIo = HistoryIo & {
  stdout: () => string
  stdoutBytes: () => Buffer
  stderr: () => string
  json: () => Record<string, unknown>
}

export function captureIo(): CapturedIo {
  const out: Buffer[] = []
  const err: string[] = []
  return {
    out: async data => { out.push(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)) },
    err: async text => { err.push(text) },
    stdout: () => Buffer.concat(out).toString('utf8'),
    stdoutBytes: () => Buffer.concat(out),
    stderr: () => err.join(''),
    json: () => JSON.parse(Buffer.concat(out).toString('utf8').trim().split('\n').pop()!) as Record<string, unknown>,
  }
}

export function rawCid(bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest()
  const body = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest])
  return `b${base32.encode(body).toLowerCase().replace(/=+$/, '')}`
}

export function fakeFetch(objects: Map<string, Uint8Array>): (input: string | URL) => Promise<Response> {
  return async input => {
    const url = String(input)
    const cid = url.split('/ipfs/')[1]
    const bytes = cid ? objects.get(decodeURIComponent(cid)) : undefined
    return bytes ? new Response(Buffer.from(bytes)) : new Response('not found', { status: 404 })
  }
}
