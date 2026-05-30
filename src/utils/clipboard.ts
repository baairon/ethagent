import { spawn } from 'node:child_process'

export type CopyResult = { ok: true; method: string; chars: number } | { ok: false; error: string }

type CopyAttempt = { ok: true; method: string } | { ok: false; error: string }

export async function copyToClipboard(text: string): Promise<CopyResult> {
  const chars = text.length
  const native = await tryNative(text)
  if (native.ok) return { ...native, chars }

  const tmux = await tryTmux(text)
  if (tmux.ok) return { ...tmux, chars }

  try {
    process.stdout.write(osc52(text))
    return { ok: true, method: 'osc52', chars }
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message || 'osc52 write failed' }
  }
}

async function tryNative(text: string): Promise<CopyAttempt> {
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

async function tryTmux(text: string): Promise<CopyAttempt> {
  if (!process.env['TMUX']) return { ok: false, error: 'not in tmux' }
  return pipeTo('tmux', ['load-buffer', '-w', '-'], text, 'tmux load-buffer')
}

function pipeTo(cmd: string, args: string[], text: string, method: string): Promise<CopyAttempt> {
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
