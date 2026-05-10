import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { EthagentIdentity } from '../../storage/config.js'
import { continuityVaultRef } from './storage.js'
import { buildZip, type ZipEntry } from './zipWriter.js'

type LocalBackupResult =
  | { ok: true; path: string; method: string }
  | { ok: false; cancelled: boolean; error: string }

type SaveDialogCommand = {
  cmd: string
  args: string[]
  method: string
}

export async function exportLocalBackup(
  identity: EthagentIdentity,
  options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    spawnImpl?: typeof spawn
    homeDir?: string
  } = {},
): Promise<LocalBackupResult> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()
  const ref = continuityVaultRef(identity)

  const entries: ZipEntry[] = []
  for (const [name, file] of [
    ['SOUL.md', ref.soulPath],
    ['MEMORY.md', ref.memoryPath],
    ['skills.json', ref.publicSkillsPath],
  ] as const) {
    try {
      const data = await fsp.readFile(file)
      entries.push({ name, data })
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        return { ok: false, cancelled: false, error: `read ${name} failed: ${(err as Error).message}` }
      }
    }
  }
  if (entries.length === 0) {
    return { ok: false, cancelled: false, error: 'no local continuity files to back up' }
  }

  const archive = buildZip(entries)
  const defaultName = defaultBackupFilename(identity)
  const dialog = resolveSaveDialogCommand(platform, env, defaultName)

  if (dialog) {
    const chosen = await runSaveDialog(dialog, options.spawnImpl ?? spawn, options.timeoutMs ?? 120_000)
    if (chosen.ok) {
      const target = ensureZipExtension(chosen.file)
      try {
        await fsp.writeFile(target, archive)
        return { ok: true, path: target, method: dialog.method }
      } catch (err: unknown) {
        return { ok: false, cancelled: false, error: `write failed: ${(err as Error).message}` }
      }
    }
    if (!chosen.cancelled) {
      const fallback = path.join(homeDir, defaultName)
      try {
        await fsp.writeFile(fallback, archive)
        return { ok: true, path: fallback, method: 'home dir fallback' }
      } catch (err: unknown) {
        return { ok: false, cancelled: false, error: `write failed: ${(err as Error).message}` }
      }
    }
    return chosen
  }

  const fallback = path.join(homeDir, defaultName)
  try {
    await fsp.writeFile(fallback, archive)
    return { ok: true, path: fallback, method: 'home dir' }
  } catch (err: unknown) {
    return { ok: false, cancelled: false, error: `write failed: ${(err as Error).message}` }
  }
}

function defaultBackupFilename(identity: EthagentIdentity): string {
  const idPart = identity.agentId ? `agent-${identity.agentId}` : 'agent'
  const stamp = timestampSlug(new Date())
  return `ethagent-backup-${idPart}-${stamp}.zip`
}

function timestampSlug(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function ensureZipExtension(file: string): string {
  return /\.zip$/i.test(file) ? file : `${file}.zip`
}

function resolveSaveDialogCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, defaultName: string): SaveDialogCommand | null {
  if (platform === 'win32') {
    const powershell = findExecutable('powershell.exe', env, platform) ?? findExecutable('pwsh.exe', env, platform)
    if (!powershell) return null
    return {
      cmd: powershell,
      args: [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
          'Add-Type -AssemblyName System.Windows.Forms',
          '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
          '$dialog.Title = "Save Local Backup"',
          '$dialog.Filter = "Zip archive (*.zip)|*.zip|All files (*.*)|*.*"',
          '$dialog.DefaultExt = "zip"',
          `$dialog.FileName = "${defaultName.replace(/"/g, '`"')}"`,
          '$dialog.OverwritePrompt = $true',
          'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }',
        ].join('; '),
      ],
      method: 'windows save dialog',
    }
  }
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: [
        '-e',
        `set chosen to choose file name with prompt "Save Local Backup" default name "${defaultName.replace(/"/g, '\\"')}"`,
        '-e',
        'POSIX path of chosen',
      ],
      method: 'macOS save dialog',
    }
  }
  const zenity = findExecutable('zenity', env, platform)
  if (zenity) {
    return {
      cmd: zenity,
      args: [
        '--file-selection',
        '--save',
        '--confirm-overwrite',
        '--title=Save Local Backup',
        `--filename=${path.join(env.HOME ?? '.', defaultName)}`,
        '--file-filter=Zip archive | *.zip',
      ],
      method: 'zenity',
    }
  }
  const kdialog = findExecutable('kdialog', env, platform)
  if (kdialog) {
    return {
      cmd: kdialog,
      args: ['--getsavefilename', path.join(env.HOME ?? '.', defaultName), 'Zip archive (*.zip)'],
      method: 'kdialog',
    }
  }
  return null
}

function runSaveDialog(
  command: SaveDialogCommand,
  spawnImpl: typeof spawn,
  timeoutMs: number,
): Promise<{ ok: true; file: string } | { ok: false; cancelled: boolean; error: string }> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawnImpl(command.cmd, command.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err: unknown) {
      resolve({ ok: false, cancelled: false, error: (err as Error).message })
      return
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, cancelled: false, error: 'save dialog timed out' })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, cancelled: false, error: err.message })
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const file = stdout.trim()
      if (code === 0 && file) {
        resolve({ ok: true, file })
        return
      }
      const detail = stderr.trim()
      const cancelled = code === 0 || /cancel/i.test(detail)
      resolve({ ok: false, cancelled, error: cancelled ? 'save cancelled' : detail || `${command.method} exited ${code}` })
    })
  })
}

function findExecutable(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const hasPathSeparator = command.includes('/') || command.includes('\\')
  if (hasPathSeparator || path.isAbsolute(command)) return canAccessExecutable(command) ? command : null
  const pathParts = (env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']
  for (const dir of pathParts) {
    for (const ext of extensions) {
      const candidate = path.join(dir, platform === 'win32' && path.extname(command) === '' ? `${command}${ext}` : command)
      if (canAccessExecutable(candidate)) return candidate
      if (platform === 'win32') {
        const lower = path.join(dir, path.extname(command) === '' ? `${command}${ext.toLowerCase()}` : command)
        if (canAccessExecutable(lower)) return lower
      }
    }
  }
  return null
}

function canAccessExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}
