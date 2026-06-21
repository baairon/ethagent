import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir, loadConfig } from '../storage/config.js'
import { detectSyncTargets, runSync } from './sync.js'
import { daemonDisabled, daemonStatus, ensureDaemon } from './daemon.js'
import { installAutostart, type AutostartResult } from './autostart.js'

export const BOOTSTRAP_VERSION = 1

function statePath(): string {
  return path.join(getConfigDir(), 'bootstrap-state.json')
}

function isStateFresh(): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as { version?: unknown }
    return parsed.version === BOOTSTRAP_VERSION
  } catch {
    return false
  }
}

function stampState(): void {
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true })
    fs.writeFileSync(statePath(), `${JSON.stringify({ version: BOOTSTRAP_VERSION })}\n`, 'utf8')
  } catch {}
}

export async function runBootstrap(opts: { quiet?: boolean } = {}): Promise<number> {
  const config = await loadConfig()
  if (!config?.identity) {
    if (!opts.quiet) process.stdout.write('ethagent: no identity yet; run `npx ethagent` to create or link one first\n')
    return 0
  }

  const targets = await detectSyncTargets()
  const actions: string[] = []
  for (const adapter of targets) {
    if (!adapter.bootstrap) continue
    try {
      actions.push(...(await adapter.bootstrap()))
    } catch (err) {
      actions.push(`${adapter.name}: bootstrap failed (${(err as Error).message})`)
    }
  }

  await runSync({ quiet: true })
  ensureDaemon()
  const autostart: AutostartResult = !daemonDisabled() ? installAutostart() : { installed: false, detail: '' }
  stampState()

  if (!opts.quiet) {
    if (actions.length === 0) {
      process.stdout.write('ethagent: harnesses already wired; autosync is active\n')
    } else {
      for (const action of actions) process.stdout.write(`  ${action}\n`)
    }
    if (daemonDisabled()) {
      process.stdout.write('ethagent: background autosync is paused or disabled\n')
    } else {
      const status = daemonStatus()
      process.stdout.write(
        status.running
          ? `ethagent: autosync running in the background (pid ${status.pid})\n`
          : 'ethagent: autosync could not start (run `ethagent watch` in a terminal)\n',
      )
      if (autostart.installed) process.stdout.write(`ethagent: it will also start with new terminals (${autostart.detail})\n`)
    }
  }
  return 0
}

export async function ensureBootstrapped(): Promise<void> {
  try {
    if (daemonDisabled()) return
    const config = await loadConfig()
    if (!config?.identity) return
    if (isStateFresh()) {
      ensureDaemon()
    } else {
      await runBootstrap({ quiet: true })
    }
  } catch {}
}
