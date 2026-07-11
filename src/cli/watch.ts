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
const RESCAN_IDLE_MAX_MS = 300_000
const RECURSIVE = process.platform === 'win32' || process.platform === 'darwin'

export function nextRescanDelay(currentDelay: number, sawEventSinceRescan: boolean): number {
  if (sawEventSinceRescan) return RESCAN_MS
  return Math.min(Math.max(currentDelay, RESCAN_MS) * 2, RESCAN_IDLE_MAX_MS)
}

function logDaemon(message: string): void {
  try {
    fs.appendFileSync(daemonLogPath(), `${new Date().toISOString()} ${message}\n`)
  } catch {}
}

export function keyPath(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isSyncWorthyChange(
  dir: string,
  filename: string | Buffer | null,
  sourceKeys: string[],
  fileKeys: Set<string>,
): boolean {
  if (typeof filename !== 'string' || filename === '') return true
  if (path.basename(filename).startsWith('.')) return false
  const full = keyPath(path.resolve(dir, filename))
  if (fileKeys.has(full)) return true
  return sourceKeys.some(src => full === src || full.startsWith(src + path.sep))
}

type WatchTargets = { dirs: Set<string>; sourceKeys: string[]; fileKeys: Set<string> }

async function computeWatchTargets(): Promise<WatchTargets> {
  const dirs = new Set<string>()
  const sourceKeys: string[] = []
  const fileKeys = new Set<string>()
  const config = await loadConfig()
  if (config?.identity) {
    const ref = continuityVaultRef(config.identity)
    dirs.add(ref.dir)
    sourceKeys.push(keyPath(ref.dir))
    if (!RECURSIVE) {
      const skillsDir = path.join(ref.dir, 'skills')
      dirs.add(skillsDir)
      try {
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) dirs.add(path.join(skillsDir, entry.name))
        }
      } catch {}
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
  let rescanDelay = RESCAN_MS
  let sawEventSinceRescan = false
  const watched = new Map<string, fs.FSWatcher>()
  let sourceKeys: string[] = []
  let fileKeys = new Set<string>()

  const isInteresting = (dir: string, filename: string | Buffer | null): boolean =>
    isSyncWorthyChange(dir, filename, sourceKeys, fileKeys)

  const cleanup = (): void => {
    stopped = true
    if (rescan) clearTimeout(rescan)
    if (timer) clearTimeout(timer)
    for (const watcher of watched.values()) { try { watcher.close() } catch {} }
    watched.clear()
    clearDaemonPid()
  }
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('exit', cleanup)

  const trigger = (): void => {
    if (stopped) return
    sawEventSinceRescan = true
    if (rescanDelay !== RESCAN_MS) {
      rescanDelay = RESCAN_MS
      scheduleRescan()
    }
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
          try { watcher.close() } catch {}
          watched.delete(dir)
        })
        watched.set(dir, watcher)
      } catch {}
    }
    for (const [dir, watcher] of watched) {
      if (desired.has(dir)) continue
      try { watcher.close() } catch {}
      watched.delete(dir)
    }
  }

  const scheduleRescan = (): void => {
    if (stopped) return
    if (rescan) clearTimeout(rescan)
    rescan = setTimeout(() => {
      const sawEvent = sawEventSinceRescan
      sawEventSinceRescan = false
      rescanDelay = nextRescanDelay(rescanDelay, sawEvent)
      void syncWatchers().finally(scheduleRescan)
    }, rescanDelay)
  }

  await syncWatchers()
  scheduleRescan()

  await run()
  if (!isDaemon) process.stdout.write('ethagent: watching for changes (ctrl-c to stop)\n')
  await new Promise<void>(() => {})
  return 0
}
