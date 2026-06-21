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

export function daemonStatus(): { running: boolean; pid: number | null } {
  const pid = readDaemonPid()
  return pid && isPidAlive(pid) ? { running: true, pid } : { running: false, pid: null }
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
    })
    child.unref()
    try { fs.closeSync(out) } catch {}
    return true
  } catch {
    return false
  }
}

export function stopDaemon(): boolean {
  const pid = readDaemonPid()
  let stopped = false
  if (pid && isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM')
      stopped = true
    } catch {}
  }
  clearDaemonPid()
  return stopped
}
