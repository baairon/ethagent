import { parseArgs, type ParseArgsConfig } from 'node:util'
import { loadConfig, type EthagentConfig, type EthagentIdentity } from '../../storage/config.js'
import { listPublishedContinuitySnapshots, type PublishedContinuitySnapshot } from '../../identity/continuity/snapshots.js'
import type { FetchLike } from '../../identity/storage/ipfs.js'
import type { OperatorKeyResult } from '../operatorKey.js'

export const SCHEMA = 1

export type HistoryIo = {
  out: (data: string | Uint8Array) => Promise<void>
  err: (text: string) => Promise<void>
}

function writeTo(stream: NodeJS.WriteStream, data: string | Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(data, err => (err ? reject(err) : resolve()))
  })
}

export const processIo: HistoryIo = {
  out: data => writeTo(process.stdout, data),
  err: text => writeTo(process.stderr, text),
}

export type HistoryDeps = {
  io: HistoryIo
  env: NodeJS.ProcessEnv
  now: () => Date
  loadConfig: () => Promise<EthagentConfig | null>
  listLedger: (identity: EthagentIdentity) => Promise<PublishedContinuitySnapshot[]>
  fetchImpl?: FetchLike
  operatorKey?: OperatorKeyResult
}

export function defaultHistoryDeps(): HistoryDeps {
  return {
    io: processIo,
    env: process.env,
    now: () => new Date(),
    loadConfig,
    listLedger: identity => listPublishedContinuitySnapshots(identity, Number.MAX_SAFE_INTEGER),
  }
}

export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export class HistoryError extends Error {
  constructor(readonly code: number, message: string, readonly hint?: string) {
    super(message)
    this.name = 'HistoryError'
  }
}

export async function emitJson(io: HistoryIo, value: Record<string, unknown>): Promise<void> {
  await io.out(`${asciiJson({ schema: SCHEMA, ok: true, ...value })}\n`)
}

export async function fail(io: HistoryIo, json: boolean, code: number, error: string, hint?: string): Promise<number> {
  if (json) await io.out(`${asciiJson({ schema: SCHEMA, ok: false, code, error, ...(hint ? { hint } : {}) })}\n`)
  else await io.err(`${error}${hint ? `\n${hint}` : ''}\n`)
  return code
}

export async function failFrom(io: HistoryIo, json: boolean, err: unknown): Promise<number> {
  if (err instanceof HistoryError) return fail(io, json, err.code, err.message, err.hint)
  const name = err instanceof Error ? err.name : ''
  if (name === 'StoreBusyError') return fail(io, json, 1, (err as Error).message)
  if (name === 'StoreCorruptError') return fail(io, json, 1, (err as Error).message)
  return fail(io, json, 1, err instanceof Error ? err.message : String(err))
}

export type ParsedArgs = {
  values: Record<string, string | boolean | string[] | undefined>
  positionals: string[]
}

export function parseHistoryArgs(args: string[], options: ParseArgsConfig['options'], usage: string): ParsedArgs {
  try {
    const parsed = parseArgs({
      args,
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, ...options },
      allowPositionals: true,
      strict: true,
    })
    return { values: parsed.values as ParsedArgs['values'], positionals: parsed.positionals }
  } catch (err) {
    throw new HistoryError(2, err instanceof Error ? err.message : String(err), `usage: ${usage}`)
  }
}

export async function requireIdentity(deps: HistoryDeps): Promise<{ config: EthagentConfig; identity: EthagentIdentity }> {
  const config = await deps.loadConfig().catch(() => null)
  if (!config?.identity) {
    throw new HistoryError(1, 'No agent identity yet.', 'Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')
  }
  return { config, identity: config.identity }
}

export function shortCid(cid: string): string {
  return cid.length > 16 ? `${cid.slice(0, 10)}...${cid.slice(-6)}` : cid
}

export function shortTime(iso: string): string {
  return iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, 'Z')
}

export function stringValues(value: string | boolean | string[] | undefined): string[] {
  if (value === undefined || typeof value === 'boolean') return []
  return Array.isArray(value) ? value : [value]
}

export function numberValue(value: string | boolean | string[] | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const raw = Array.isArray(value) ? value[value.length - 1] : value
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 0) throw new HistoryError(2, `--${name} expects a whole number`)
  return parsed
}
