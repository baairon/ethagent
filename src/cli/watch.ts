import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../storage/config.js'
import { continuityVaultRef } from '../identity/continuity/storage/paths.js'
import { runSync } from './sync.js'
import { BUILT_IN_ADAPTERS, adapterManagedFilePaths } from './syncAdapters/index.js'
import {
  clearDaemonPid,
  daemonDisabled,
  daemonLogPath,
  daemonStatus,
  stopDaemon,
  tryClaimDaemonPid,
} from './daemon.js'

const DEBOUNCE_MS = 400
const COOLDOWN_MS = 800
const RESCAN_MS = 30_000
// fs.watch only supports recursive watches on Windows and macOS.
const RECURSIVE = process.platform === 'win32' || process.platform === 'darwin'

function logDaemon(message: string): void {
  try {
    fs.appendFileSync(daemonLogPath(), `${new Date().toISOString()} ${message}\n`)
  } catch { /* logging is best-effort */ }
}

export function keyPath(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Whether a watch event should trigger a sync: only changes to the vault subtree (sourceKeys)
 * or an exact managed instruction file (fileKeys) count. Everything else under a watched
 * harness root, its session/log churn and our own skills-mirror output, is ignored. A
 * dot-prefixed name is always ignored; an unknown (null) filename is conservatively synced.
 * Exported as a pure function so the storm-prevention logic is unit-testable.
 */
export function isSyncWorthyChange(
  dir: string,
  filename: string | Buffer | null,
  sourceKeys: string[],
  fileKeys: Set<string>,
): boolean {
  if (typeof filename !== 'string' || filename === '') return true // unknown path -> be safe
  if (path.basename(filename).startsWith('.')) return false
  const full = keyPath(path.resolve(dir, filename))
  if (fileKeys.has(full)) return true
  return sourceKeys.some(src => full === src || full.startsWith(src + path.sep))
}

type WatchTargets = { dirs: Set<string>; sourceKeys: string[]; fileKeys: Set<string> }

/**
 * The directories to watch, plus the only paths whose changes should trigger a sync: the
 * vault subtree (our source of truth) and the exact harness instruction files we pull edits
 * back from. We deliberately do NOT react to everything under a harness root. Those roots
 * (~/.claude, ~/.codex, or a generic target's project directory) are watched recursively on
 * Windows/macOS but churn constantly with session transcripts, logs, and SQLite the harness
 * rewrites many times a second; reacting to all of it would spin runSync into a continuous
 * background storm driven entirely by unrelated harness activity.
 */
async function computeWatchTargets(): Promise<WatchTargets> {
  const dirs = new Set<string>()
  const sourceKeys: string[] = []
  const fileKeys = new Set<string>()
  const config = await loadConfig()
  if (config?.identity) {
    const ref = continuityVaultRef(config.identity)
    dirs.add(ref.dir)
    sourceKeys.push(keyPath(ref.dir))
    const skillsDir = path.join(ref.dir, 'skills')
    dirs.add(skillsDir)
    // On non-recursive platforms (Linux), nested skill folders need their own watchers
    // or edits to skills/<name>/SKILL.md are never seen.
    if (!RECURSIVE) {
      try {
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) dirs.add(path.join(skillsDir, entry.name))
        }
      } catch { /* no skills dir yet */ }
    }
  }
  for (const adapter of BUILT_IN_ADAPTERS) {
    if (!(await adapter.detect().catch(() => false))) continue
    for (const file of await adapterManagedFilePaths(adapter)) {
      dirs.add(path.dirname(file))
      fileKeys.add(keyPath(file))
    }
  }
  return { dirs, sourceKeys, fileKeys }
}

export async function runWatch(argv: string[]): Promise<number> {
  if (argv.includes('--status')) {
    const status = daemonStatus()
    process.stdout.write(
      status.running
        ? `ethagent: autosync daemon running (pid ${status.pid}); log ${daemonLogPath()}\n`
        : 'ethagent: autosync daemon not running\n',
    )
    return 0
  }
  if (argv.includes('--stop')) {
    const stopped = stopDaemon()
    process.stdout.write(stopped ? 'ethagent: autosync daemon stopped\n' : 'ethagent: no autosync daemon was running\n')
    return 0
  }

  const isDaemon = argv.includes('--daemon')

  // The daemon can be launched directly (shell hook), so re-check pause/disable here too.
  if (daemonDisabled()) {
    if (!isDaemon) process.stdout.write('ethagent: background sync is paused or disabled\n')
    return 0
  }

  const config = await loadConfig()
  if (!config?.identity) {
    if (!isDaemon) process.stderr.write('ethagent: no identity yet; nothing to watch\n')
    return 0
  }

  if (!tryClaimDaemonPid()) {
    if (!isDaemon) process.stdout.write('ethagent: watcher already running\n')
    return 0
  }

  let rescan: NodeJS.Timeout | null = null
  let timer: NodeJS.Timeout | null = null
  let syncing = false
  let stopped = false
  let cooldownUntil = 0
  const watched = new Map<string, fs.FSWatcher>()
  let sourceKeys: string[] = []
  let fileKeys = new Set<string>()

  // Only the vault subtree and the exact managed instruction files are sync-worthy; the rest
  // of a watched harness root (its churn, and our own skills-mirror output) is ignored.
  const isInteresting = (dir: string, filename: string | Buffer | null): boolean =>
    isSyncWorthyChange(dir, filename, sourceKeys, fileKeys)

  const cleanup = (): void => {
    stopped = true
    if (rescan) clearInterval(rescan)
    if (timer) clearTimeout(timer)
    for (const watcher of watched.values()) { try { watcher.close() } catch { /* best-effort */ } }
    watched.clear()
    clearDaemonPid()
  }
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('exit', cleanup)

  const trigger = (): void => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void run() }, DEBOUNCE_MS)
  }
  const run = async (): Promise<void> => {
    if (stopped) return
    if (syncing || Date.now() < cooldownUntil) { trigger(); return }
    syncing = true
    try {
      await runSync({ quiet: true })
    } catch (err) {
      logDaemon(`sync error: ${(err as Error).message}`)
    }
    syncing = false
    cooldownUntil = Date.now() + COOLDOWN_MS
  }

  // Add watchers for newly-relevant dirs and drop watchers for dirs no longer needed,
  // so a long-lived daemon never accumulates dead watchers (and picks up --add targets).
  const syncWatchers = async (): Promise<void> => {
    if (stopped) return
    const targets = await computeWatchTargets()
    sourceKeys = targets.sourceKeys
    fileKeys = targets.fileKeys
    const desired = targets.dirs
    for (const dir of desired) {
      if (watched.has(dir)) continue
      try {
        fs.mkdirSync(dir, { recursive: true })
        const watcher = fs.watch(dir, { recursive: RECURSIVE }, (_event, filename) => {
          if (isInteresting(dir, filename)) trigger()
        })
        watcher.on('error', () => {
          logDaemon(`watcher error on ${dir}`)
          try { watcher.close() } catch { /* best-effort */ }
          watched.delete(dir)
        })
        watched.set(dir, watcher)
      } catch { /* unwatchable dir is non-fatal */ }
    }
    for (const [dir, watcher] of watched) {
      if (desired.has(dir)) continue
      try { watcher.close() } catch { /* best-effort */ }
      watched.delete(dir)
    }
  }

  await syncWatchers()
  rescan = setInterval(() => { void syncWatchers() }, RESCAN_MS)

  await run()
  if (!isDaemon) process.stdout.write('ethagent: watching for changes (ctrl-c to stop)\n')
  await new Promise<void>(() => { /* run until signalled */ })
  return 0
}
