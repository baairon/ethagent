import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type CopyResult = { ok: true; method: string } | { ok: false; error: string }
export type ReadResult = { ok: true; text: string; method: string } | { ok: false; error: string }
export type ReadImageResult = { ok: true; path: string; method: string } | { ok: false; error: string }

export async function copyToClipboard(text: string): Promise<CopyResult> {
  const native = await tryNative(text)
  if (native.ok) return native

  const tmux = await tryTmux(text)
  if (tmux.ok) return tmux

  try {
    process.stdout.write(osc52(text))
    return { ok: true, method: 'osc52' }
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message || 'osc52 write failed' }
  }
}

async function tryNative(text: string): Promise<CopyResult> {
  if (process.platform === 'darwin') {
    return pipeTo('pbcopy', [], text, 'pbcopy')
  }
  if (process.platform === 'win32') {
    return pipeTo('clip', [], text, 'clip.exe')
  }
  const wl = await probe('wl-copy', ['--version'])
  if (wl) return pipeTo('wl-copy', [], text, 'wl-copy')
  const xclip = await probe('xclip', ['-version'])
  if (xclip) return pipeTo('xclip', ['-selection', 'clipboard'], text, 'xclip')
  const xsel = await probe('xsel', ['--version'])
  if (xsel) return pipeTo('xsel', ['--clipboard', '--input'], text, 'xsel')
  return { ok: false, error: 'no native clipboard tool found' }
}

async function tryTmux(text: string): Promise<CopyResult> {
  if (!process.env['TMUX']) return { ok: false, error: 'not in tmux' }
  return pipeTo('tmux', ['load-buffer', '-w', '-'], text, 'tmux load-buffer')
}

function pipeTo(cmd: string, args: string[], text: string, method: string): Promise<CopyResult> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch (err: unknown) {
      resolve({ ok: false, error: (err as Error).message })
      return
    }
    child.on('error', err => resolve({ ok: false, error: err.message }))
    child.on('close', code => {
      if (code === 0) resolve({ ok: true, method })
      else resolve({ ok: false, error: `${cmd} exited ${code}` })
    })
    child.stdin?.end(text, 'utf8')
  })
}

function probe(cmd: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, { stdio: 'ignore' })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
}

function osc52(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  return `\x1b]52;c;${b64}\x07`
}

export async function readClipboard(): Promise<ReadResult> {
  const native = await tryReadNative()
  if (native.ok) return native
  const tmux = await tryReadTmux()
  if (tmux.ok) return tmux
  return { ok: false, error: native.error || tmux.error || 'no clipboard tool available' }
}

async function tryReadNative(): Promise<ReadResult> {
  if (process.platform === 'darwin') {
    return readFrom('pbpaste', [], 'pbpaste')
  }
  if (process.platform === 'win32') {
    return readFrom('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], 'powershell Get-Clipboard')
  }
  if (process.env['WAYLAND_DISPLAY']) {
    const wl = await probe('wl-paste', ['--version'])
    if (wl) return readFrom('wl-paste', ['--no-newline'], 'wl-paste')
  }
  const xclip = await probe('xclip', ['-version'])
  if (xclip) return readFrom('xclip', ['-o', '-selection', 'clipboard'], 'xclip')
  const xsel = await probe('xsel', ['--version'])
  if (xsel) return readFrom('xsel', ['--output', '--clipboard'], 'xsel')
  return { ok: false, error: 'no native clipboard tool found' }
}

async function tryReadTmux(): Promise<ReadResult> {
  if (!process.env['TMUX']) return { ok: false, error: 'not in tmux' }
  return readFrom('tmux', ['save-buffer', '-'], 'tmux save-buffer')
}

function readFrom(cmd: string, args: string[], method: string): Promise<ReadResult> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (err: unknown) {
      resolve({ ok: false, error: (err as Error).message })
      return
    }
    const chunks: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', err => resolve({ ok: false, error: err.message }))
    child.on('close', code => {
      if (code === 0) {
        const text = Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        resolve({ ok: true, text: text.replace(/\n$/, ''), method })
      } else {
        resolve({ ok: false, error: `${cmd} exited ${code}` })
      }
    })
  })
}

export async function readClipboardImage(): Promise<ReadImageResult> {
  const dir = path.join(os.homedir(), '.ethagent', 'pastes')
  try {
    await mkdir(dir, { recursive: true })
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(dir, `paste-${stamp}.png`)

  if (process.platform === 'win32') return readImageWindows(dest)
  if (process.platform === 'darwin') return readImageMac(dest)
  return readImageLinux(dest)
}

function readImageWindows(dest: string): Promise<ReadImageResult> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if ($null -eq $img) { exit 2 }",
    "$img.Save($env:ETHAGENT_PASTE_PATH, [System.Drawing.Imaging.ImageFormat]::Png)",
  ].join('; ')
  return spawnImage(
    'powershell',
    ['-NoProfile', '-Sta', '-Command', script],
    { ETHAGENT_PASTE_PATH: dest },
    dest,
    'powershell',
  )
}

async function readImageMac(dest: string): Promise<ReadImageResult> {
  const has = await probe('pngpaste', ['-v'])
  if (!has) return { ok: false, error: 'pngpaste not installed (brew install pngpaste)' }
  return spawnImage('pngpaste', [dest], {}, dest, 'pngpaste')
}

async function readImageLinux(dest: string): Promise<ReadImageResult> {
  const hasXclip = await probe('xclip', ['-version'])
  if (!hasXclip) return { ok: false, error: 'xclip not available' }
  return spawnImage('sh', ['-c', `xclip -selection clipboard -t image/png -o > "${dest}"`], {}, dest, 'xclip')
}

function spawnImage(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  destPath: string,
  method: string,
): Promise<ReadImageResult> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, ...env },
      })
    } catch (err: unknown) {
      resolve({ ok: false, error: (err as Error).message })
      return
    }
    child.on('error', err => resolve({ ok: false, error: err.message }))
    child.on('close', code => {
      if (code === 2) {
        resolve({ ok: false, error: 'no image on clipboard' })
        return
      }
      if (code !== 0) {
        resolve({ ok: false, error: `${cmd} exited ${code}` })
        return
      }
      void stat(destPath)
        .then(s => {
          if (s.size === 0) resolve({ ok: false, error: 'no image saved' })
          else resolve({ ok: true, path: destPath, method })
        })
        .catch(() => resolve({ ok: false, error: 'image file not created' }))
    })
  })
}
