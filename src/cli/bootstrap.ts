import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir, loadConfig } from '../storage/config.js'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { detectSyncTargets, runSync } from './sync.js'
import { daemonDisabled, ensureDaemon, waitForDaemon } from './daemon.js'
import { installAutostart, type AutostartResult } from './autostart.js'
import type { SyncAdapter } from './syncAdapters/index.js'

export const BOOTSTRAP_VERSION = 2

export type BootstrapSeams = {
  loadConfig: typeof loadConfig
  detectTargets: (onError: (adapter: SyncAdapter, error: Error) => void) => Promise<SyncAdapter[]>
  sync: () => Promise<number>
  daemonDisabled: () => boolean
  ensureDaemon: () => boolean
  waitForDaemon: typeof waitForDaemon
  installAutostart: () => AutostartResult
}

const defaultSeams: BootstrapSeams = {
  loadConfig,
  detectTargets: onError => detectSyncTargets(undefined, onError),
  sync: () => runSync({ quiet: true }),
  daemonDisabled,
  ensureDaemon,
  waitForDaemon,
  installAutostart,
}

function statePath(): string {
  return path.join(getConfigDir(), 'bootstrap-state.json')
}

export function isStateFresh(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as { version?: unknown; daemonConfigured?: unknown }
    return parsed.version === BOOTSTRAP_VERSION && (daemonDisabled() || parsed.daemonConfigured === true)
  } catch {
    return false
  }
}

async function stampState(daemonConfigured: boolean): Promise<void> {
  fs.mkdirSync(getConfigDir(), { recursive: true })
  await atomicWriteText(statePath(), `${JSON.stringify({ version: BOOTSTRAP_VERSION, daemonConfigured })}\n`, { mode: 0o600 })
}

export async function runBootstrap(opts: { quiet?: boolean; seams?: BootstrapSeams } = {}): Promise<number> {
  const seams = opts.seams ?? defaultSeams
  const config = await seams.loadConfig()
  if (!config?.identity) {
    if (!opts.quiet) process.stdout.write('ethagent: no identity yet; run `npx ethagent create` or `npx ethagent restore <token-id>` first\n')
    return 0
  }

  const actions: string[] = []
  const failures: string[] = []
  const targets = await seams.detectTargets((adapter, err) => {
    failures.push(`${adapter.name}: detection failed (${err.message})`)
  })
  for (const adapter of targets) {
    if (!adapter.bootstrap) continue
    try {
      actions.push(...(await adapter.bootstrap()))
    } catch (err) {
      failures.push(`${adapter.name}: bootstrap failed (${(err as Error).message})`)
    }
  }

  try {
    if (await seams.sync() !== 0) failures.push('sync is incomplete; run ethagent sync after fixing the reported issues')
  } catch (err) {
    failures.push(`sync failed: ${(err as Error).message}`)
  }
  const disabled = seams.daemonDisabled()
  let daemon = { running: false, pid: null as number | null }
  let autostart: AutostartResult = { installed: false, detail: '' }
  if (!disabled) {
    try {
      seams.ensureDaemon()
      daemon = await seams.waitForDaemon()
      if (!daemon.running) failures.push('background sync did not start; run ethagent --ensure-daemon')
    } catch (err) {
      failures.push(`background sync could not start: ${(err as Error).message}`)
    }
    try {
      autostart = seams.installAutostart()
      if (!autostart.installed) failures.push(autostart.detail)
    } catch (err) {
      failures.push(`autostart could not be installed: ${(err as Error).message}`)
    }
  }
  if (failures.length === 0) {
    try { await stampState(!disabled) } catch (err) {
      failures.push(`could not record bootstrap completion: ${(err as Error).message}`)
    }
  }
  for (const failure of failures) process.stderr.write(`ethagent: ${failure}\n`)

  if (!opts.quiet) {
    if (actions.length === 0 && failures.length === 0) {
      process.stdout.write('ethagent: harnesses already wired; autosync is active\n')
    } else {
      for (const action of actions) process.stdout.write(`  ${action}\n`)
    }
    if (disabled) {
      process.stdout.write('ethagent: background autosync is paused or disabled\n')
    } else {
      process.stdout.write(
        daemon.running
          ? `ethagent: autosync running in the background (pid ${daemon.pid})\n`
          : 'ethagent: autosync could not start (run `ethagent watch` in a terminal)\n',
      )
      if (autostart.installed) process.stdout.write(`ethagent: it will also start with new terminals (${autostart.detail})\n`)
    }
  }
  return failures.length > 0 ? 1 : 0
}

let attemptedBootstrap = false

export async function ensureBootstrapped(): Promise<void> {
  try {
    if (daemonDisabled()) return
    const config = await loadConfig()
    if (!config?.identity) return
    if (isStateFresh()) {
      ensureDaemon()
    } else if (!attemptedBootstrap) {
      attemptedBootstrap = true
      await runBootstrap({ quiet: true })
    }
  } catch (err) {
    process.stderr.write(`ethagent: bootstrap failed: ${(err as Error).message}\n`)
  }
}
