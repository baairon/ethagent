import { execFileSync, spawn, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
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
// longer than DAEMON_STALE_MS no longer vouches for its pid: the daemon may be gone, and
// the operating system may have handed the pid to some other process.
export const DAEMON_HEARTBEAT_MS = 30_000
export const DAEMON_STALE_MS = 120_000
const DAEMON_TAKEOVER_WAIT_MS = 5_000
const COMMAND_LINE_TIMEOUT_MS = 5_000

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

export type CommandLineReader = (pid: number) => string | null

// What the process behind a pid was started as, or null when the system won't say.
export function readProcessCommandLine(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim() || null
    }
    const options: ExecFileSyncOptionsWithStringEncoding = {
      encoding: 'utf8',
      timeout: COMMAND_LINE_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }
    if (process.platform === 'win32') {
      // -NoProfile: the profile holds ethagent's own shell hook, which runs --ensure-daemon.
      const query = `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], options).trim() || null
    }
    return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], options).trim() || null
  } catch {
    return null
  }
}

// Every ethagent watcher, of any version, runs as `node ... main.tsx watch`, with --daemon
// when it was started in the background.
export function isWatcherCommandLine(commandLine: string | null): boolean {
  return commandLine !== null && /main\.tsx["']?\s+watch(?:\s|$)/.test(commandLine)
}

// The pid of the daemon, beating or not, or null. A pid that is alive but quiet is the
// daemon only when its process is an ethagent watcher: one from before the heartbeat, or
// one whose beats stalled. Anything else is a pid the system gave to another process.
function daemonPid(read: CommandLineReader): number | null {
  const pid = readDaemonPid()
  if (!pid || !isPidAlive(pid)) return null
  return heartbeatFresh() || isWatcherCommandLine(read(pid)) ? pid : null
}

// Beats the pid file. False tells the watcher to stop: sync was paused or disabled while
// it ran, or another live process now holds the file.
export function touchDaemonPid(): boolean {
  if (daemonDisabled()) return false
  const pid = readDaemonPid()
  if (pid !== null && pid !== process.pid && isPidAlive(pid)) return false
  if (pid === process.pid) {
    try {
      const now = new Date()
      fs.utimesSync(daemonPidPath(), now, now)
    } catch {}
    return true
  }
  // The file was removed, or left by a pid that is gone: take it back.
  try {
    fs.writeFileSync(daemonPidPath(), `${process.pid}\n`)
    return true
  } catch {
    return false
  }
}

export function daemonStatus(read: CommandLineReader = readProcessCommandLine): { running: boolean; pid: number | null } {
  const pid = daemonPid(read)
  return pid ? { running: true, pid } : { running: false, pid: null }
}

export function writeDaemonPid(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true })
  fs.writeFileSync(daemonPidPath(), `${process.pid}\n`, 'utf8')
}

// Takes the pid file for a watcher that is starting. A watcher that is beating keeps it.
// One that is alive but quiet is an older version or has stalled, so it is stopped first,
// and the file is taken only once that process is gone: an old watcher removes the pid
// file on its way out.
export async function claimDaemonPid(read: CommandLineReader = readProcessCommandLine): Promise<boolean> {
  fs.mkdirSync(getConfigDir(), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(daemonPidPath(), `${process.pid}\n`, { flag: 'wx' })
      return true
    } catch {}
    const beating = liveDaemonPid()
    if (beating && beating !== process.pid) return false
    const quiet = beating ? null : daemonPid(read)
    if (quiet && quiet !== process.pid) {
      try { process.kill(quiet, 'SIGTERM') } catch {}
      if (!(await pidGone(quiet))) return false
    }
    clearDaemonPid()
  }
  return false
}

async function pidGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + DAEMON_TAKEOVER_WAIT_MS
  while (isPidAlive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return true
}

export function clearDaemonPid(): void {
  try {
    fs.rmSync(daemonPidPath(), { force: true })
  } catch {}
}

// Removes the pid file only while it is still this process's: a watcher that was taken
// over must not delete its successor's.
export function releaseDaemonPid(): void {
  if (readDaemonPid() === process.pid) clearDaemonPid()
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
  // Only a beating daemon is left alone. A watcher that went quiet (an older version, or
  // one that stalled) is taken over by the one started here, as it claims the pid file.
  if (liveDaemonPid()) return false
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

export function stopDaemon(read: CommandLineReader = readProcessCommandLine): boolean {
  // A quiet pid is signalled only when its process is an ethagent watcher; otherwise it
  // may be anything now.
  const pid = daemonPid(read)
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
