import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type ImageFilePickerResult =
  | { ok: true; file: string; method: string }
  | { ok: false; cancelled: boolean; error: string }

type PickerCommand = {
  cmd: string
  args: string[]
  method: string
}

export async function openImageFilePicker(
  options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    spawnImpl?: typeof spawn
  } = {},
): Promise<ImageFilePickerResult> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const command = resolveImagePickerCommand(platform, env)
  if (!command) {
    return {
      ok: false,
      cancelled: false,
      error: platform === 'linux'
        ? 'install zenity or kdialog, or enter the icon path manually'
        : 'no native icon picker is available; enter the icon path manually',
    }
  }
  const result = await runPickerCommand(command, options.spawnImpl ?? spawn, options.timeoutMs ?? 120_000)
  if (!result.ok) return result
  const file = result.file.trim()
  if (!file) return { ok: false, cancelled: true, error: 'icon selection cancelled' }
  return { ok: true, file, method: command.method }
}

function resolveImagePickerCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): PickerCommand | null {
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
          '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
          '$dialog.Title = "Choose Agent Icon"',
          '$dialog.Filter = "Agent Icon (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.mp4;*.webm;*.mov)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.mp4;*.webm;*.mov|All files (*.*)|*.*"',
          '$dialog.CheckFileExists = $true',
          'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }',
        ].join('; '),
      ],
      method: 'windows file picker',
    }
  }
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: [
        '-e',
        'set selectedFile to choose file with prompt "Choose Agent Icon"',
        '-e',
        'POSIX path of selectedFile',
      ],
      method: 'macOS file picker',
    }
  }
  const zenity = findExecutable('zenity', env, platform)
  if (zenity) {
    return {
      cmd: zenity,
      args: [
        '--file-selection',
        '--title=Choose Agent Icon',
        '--file-filter=Agent Icon | *.png *.jpg *.jpeg *.gif *.webp *.svg *.mp4 *.webm *.mov',
      ],
      method: 'zenity',
    }
  }
  const kdialog = findExecutable('kdialog', env, platform)
  if (kdialog) {
    return {
      cmd: kdialog,
      args: ['--getopenfilename', '.', 'Agent Icon (*.png *.jpg *.jpeg *.gif *.webp *.svg *.mp4 *.webm *.mov)'],
      method: 'kdialog',
    }
  }
  return null
}

function runPickerCommand(
  command: PickerCommand,
  spawnImpl: typeof spawn,
  timeoutMs: number,
): Promise<ImageFilePickerResult> {
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
      resolve({ ok: false, cancelled: false, error: 'icon picker timed out' })
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
        resolve({ ok: true, file, method: command.method })
        return
      }
      const detail = stderr.trim()
      const cancelled = code === 0 || /cancel/i.test(detail)
      resolve({ ok: false, cancelled, error: cancelled ? 'icon selection cancelled' : detail || `${command.method} exited ${code}` })
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
        const lower = path.join(dir, platform === 'win32' && path.extname(command) === '' ? `${command}${ext.toLowerCase()}` : command)
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
