import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'

export const DEFAULT_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'

export type InstalledModel = {
  name: string
  sizeBytes: number
  modified?: string
}

export type PullProgress = {
  status: string
  completed?: number
  total?: number
  digest?: string
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outer = init.signal
  const onOuterAbort = (): void => controller.abort()
  outer?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

export async function isDaemonUp(host: string = DEFAULT_HOST, timeoutMs = 1500): Promise<boolean> {
  const response = await fetchWithTimeout(`${host}/api/tags`, { method: 'GET' }, timeoutMs)
  return response !== null && response.ok
}

export async function listInstalled(host: string = DEFAULT_HOST): Promise<InstalledModel[]> {
  const response = await fetchWithTimeout(`${host}/api/tags`, { method: 'GET' }, 5000)
  if (!response || !response.ok) return []
  try {
    const data = (await response.json()) as {
      models?: Array<{ name?: string; size?: number; modified_at?: string }>
    }
    return (data.models ?? [])
      .filter(m => typeof m.name === 'string' && m.name.length > 0)
      .map(m => ({
        name: m.name!,
        sizeBytes: m.size ?? 0,
        modified: m.modified_at,
      }))
  } catch {
    return []
  }
}

export async function waitForDaemon(host: string = DEFAULT_HOST, timeoutMs = 15000, pollMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDaemonUp(host, 1000)) return true
    await new Promise<void>(resolve => setTimeout(resolve, pollMs))
  }
  return isDaemonUp(host, 1000)
}

function spawnDetached(cmd: string, args: string[]): boolean {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => { void 0 })
    child.unref()
    return true
  } catch {
    return false
  }
}

export async function startDaemon(host: string = DEFAULT_HOST): Promise<boolean> {
  const platform = process.platform
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? ''
    const candidate = path.join(localAppData, 'Programs', 'Ollama', 'Ollama.exe')
    let launched = false
    try {
      await fs.access(candidate)
      launched = spawnDetached(candidate, [])
    } catch {
      launched = false
    }
    if (!launched) {
      spawnDetached('ollama', ['serve'])
    }
  } else if (platform === 'darwin') {
    if (!spawnDetached('open', ['-a', 'Ollama'])) {
      spawnDetached('ollama', ['serve'])
    }
  } else {
    spawnDetached('ollama', ['serve'])
  }
  return waitForDaemon(host)
}

type InstallResult = { ok: true } | { ok: false; message: string }

function runInstallCommand(
  cmd: string,
  args: string[],
  onLog: ((line: string) => void) | undefined,
  timeoutMs: number,
): Promise<InstallResult> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ ok: false, message: (err as Error).message })
      return
    }
    let settled = false
    const settle = (result: InstallResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch { void 0 }
      resolve(result)
    }
    const timer = setTimeout(() => settle({ ok: false, message: `${cmd} timed out` }), timeoutMs)
    const onData = (chunk: Buffer | string): void => {
      const text = chunk.toString()
      if (!onLog) return
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLog(line)
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', err => settle({ ok: false, message: err.message }))
    child.on('close', code => {
      if (code === 0) settle({ ok: true })
      else settle({ ok: false, message: `${cmd} exited with code ${code ?? 'unknown'}` })
    })
  })
}

export async function installOllama(onLog?: (line: string) => void): Promise<InstallResult> {
  const platform = process.platform
  if (platform === 'win32') {
    return runInstallCommand(
      'winget',
      ['install', '--id', 'Ollama.Ollama', '--accept-source-agreements', '--accept-package-agreements', '--silent'],
      onLog,
      5 * 60_000,
    )
  }
  if (platform === 'darwin') {
    return runInstallCommand('brew', ['install', '--cask', 'ollama'], onLog, 5 * 60_000)
  }
  return runInstallCommand('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], onLog, 5 * 60_000)
}

export async function* pullModel(
  name: string,
  host: string = DEFAULT_HOST,
  signal?: AbortSignal,
): AsyncIterable<PullProgress> {
  const response = await fetch(`${host}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
    signal,
  })
  if (!response.ok || !response.body) {
    const detail = response.ok ? 'empty body' : `HTTP ${response.status}`
    throw new Error(`pull failed: ${detail}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        newlineIdx = buffer.indexOf('\n')
        if (!line) continue
        try {
          yield JSON.parse(line) as PullProgress
        } catch {
          continue
        }
      }
    }
    const tail = buffer.trim()
    if (tail) {
      try { yield JSON.parse(tail) as PullProgress } catch { void 0 }
    }
  } finally {
    try { reader.releaseLock() } catch { void 0 }
  }
}
