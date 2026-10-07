import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfigDir } from '../storage/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function daemonPidPath(): string {
  return path.join(getConfigDir(), 'daemon.pid')
}

export function daemonLogPath(): string {
  return path.join(getConfigDir(), 'daemon.log')
}

export function binEntry(): string {
  return path.resolve(__dirname, '..', '..', 'bin', 'ethagent.js')
}

export function syncPausedPath(): string {
  return path.join(getConfigDir(), 'sync-paused')
}

export function isPaused(): boolean {
  try {
    return fs.existsSync(syncPausedPath())
  } catch {
    return false
  }
}

export function pauseSync(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true })
  fs.writeFileSync(syncPausedPath(), '', 'utf8')
  stopDaemon()
}

export function resumeSync(): void {
  try {
    fs.rmSync(syncPausedPath(), { force: true })
  } catch {}
}

export function daemonDisabled(): boolean {
  const v = process.env.ETHAGENT_NO_DAEMON
  if (v && v !== '0' && v.toLowerCase() !== 'false') return true
  return isPaused()
}

export function readDaemonPid(): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(daemonPidPath(), 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// The daemon touches its pid file every DAEMON_HEARTBEAT_MS. A pid file left quiet for
// longer than DAEMON_STALE_MS belongs to a daemon that is gone, even when the operating
// system has since handed its pid to some other process.
export const DAEMON_HEARTBEAT_MS = 30_000
export const DAEMON_STALE_MS = 120_000

function heartbeatFresh(): boolean {
  try {
    return Date.now() - fs.statSync(daemonPidPath()).mtimeMs < DAEMON_STALE_MS
  } catch {
    return false
  }
}

// The pid of a daemon that is alive and still beating, or null.
function liveDaemonPid(): number | null {
  const pid = readDaemonPid()
  return pid && isPidAlive(pid) && heartbeatFresh() ? pid : null
}

export function touchDaemonPid(): void {
  if (readDaemonPid() !== process.pid) return
  try {
    const now = new Date()
    fs.utimesSync(daemonPidPath(), now, now)
  } catch {}
}

export function daemonStatus(): { running: boolean; pid: number | null } {
  const pid = liveDaemonPid()
  if (pid) return { running: true, pid }
  // A leftover file would otherwise read as running the moment its pid is reused.
  if (readDaemonPid() !== null) clearDaemonPid()
  return { running: false, pid: null }
}

export function writeDaemonPid(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true })
  fs.writeFileSync(daemonPidPath(), `${process.pid}\n`, 'utf8')
}

export function tryClaimDaemonPid(): boolean {
  fs.mkdirSync(getConfigDir(), { recursive: true })
  try {
    fs.writeFileSync(daemonPidPath(), `${process.pid}\n`, { flag: 'wx' })
    return true
  } catch {
    const existing = daemonStatus()
    if (existing.running && existing.pid !== process.pid) return false
    try {
      fs.writeFileSync(daemonPidPath(), `${process.pid}\n`)
      return true
    } catch {
      return false
    }
  }
}

export function clearDaemonPid(): void {
  try {
    fs.rmSync(daemonPidPath(), { force: true })
  } catch {}
}

export function daemonEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === 'ETHAGENT_OPERATOR_KEY') continue
    out[key] = value
  }
  return out
}

export function ensureDaemon(): boolean {
  if (daemonDisabled()) return false
  if (daemonStatus().running) return false
  try {
    fs.mkdirSync(getConfigDir(), { recursive: true })
    const out = fs.openSync(daemonLogPath(), 'a')
    const child = spawn(process.execPath, [binEntry(), 'watch', '--daemon'], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', out, out],
      windowsHide: true,
      env: daemonEnv(process.env),
    })
    child.unref()
    try { fs.closeSync(out) } catch {}
    return true
  } catch {
    return false
  }
}

export function stopDaemon(): boolean {
  // Only a pid that is still beating is ours to signal; a stale one may be anything now.
  const pid = liveDaemonPid()
  let stopped = false
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
      stopped = true
    } catch {}
  }
  clearDaemonPid()
  return stopped
}
