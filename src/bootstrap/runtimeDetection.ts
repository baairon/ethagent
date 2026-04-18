import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

export type OllamaModel = {
  name: string
  sizeBytes?: number
  parameterSize?: string
  quantization?: string
}

export type SpecSnapshot = {
  platform: NodeJS.Platform
  arch: string
  cpuCores: number
  totalRamBytes: number
  effectiveRamBytes: number
  isAppleSilicon: boolean
  gpuVramBytes: number | null
  hasOllama: boolean
  ollamaVersion: string | null
  ollamaDaemonUp: boolean
  installedModels: OllamaModel[]
}

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'

function runCommand(cmd: string, args: string[], timeoutMs = 2000): Promise<{ code: number; stdout: string; stderr: string } | null> {
  return new Promise(resolve => {
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { void 0 }
      resolve(null)
    }, timeoutMs)

    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function detectNvidiaVram(): Promise<number | null> {
  const result = await runCommand('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'])
  if (!result || result.code !== 0) return null
  const firstLine = result.stdout.split('\n').map(l => l.trim()).find(Boolean)
  if (!firstLine) return null
  const mib = Number.parseInt(firstLine, 10)
  if (!Number.isFinite(mib) || mib <= 0) return null
  return mib * 1024 * 1024
}

async function detectOllamaVersion(): Promise<string | null> {
  const result = await runCommand('ollama', ['--version'])
  if (!result || result.code !== 0) return null
  const match = result.stdout.match(/\d+\.\d+\.\d+/)
  return match ? match[0] : result.stdout.trim() || null
}

async function detectOllamaOnDisk(): Promise<boolean> {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'))
      candidates.push(path.join(localAppData, 'Programs', 'Ollama', 'Ollama.exe'))
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Ollama.app/Contents/Resources/ollama')
    candidates.push('/usr/local/bin/ollama')
    candidates.push('/opt/homebrew/bin/ollama')
  } else {
    candidates.push('/usr/local/bin/ollama', '/usr/bin/ollama')
  }
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return true
    } catch {
      continue
    }
  }
  return false
}

async function fetchInstalledModels(): Promise<{ up: boolean; models: OllamaModel[] }> {
  const response = await fetchWithTimeout(`${OLLAMA_HOST}/api/tags`, 400)
  if (!response || !response.ok) return { up: false, models: [] }
  try {
    const data = (await response.json()) as {
      models?: Array<{
        name?: string
        size?: number
        details?: { parameter_size?: string; quantization_level?: string }
      }>
    }
    const models: OllamaModel[] = (data.models ?? [])
      .filter(m => typeof m.name === 'string' && m.name.length > 0)
      .map(m => ({
        name: m.name!,
        sizeBytes: m.size,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
      }))
    return { up: true, models }
  } catch {
    return { up: true, models: [] }
  }
}

export async function detectSpec(): Promise<SpecSnapshot> {
  const platform = process.platform
  const arch = process.arch
  const cpuCores = os.cpus().length
  const totalRamBytes = os.totalmem()
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64'
  const effectiveRamBytes = isAppleSilicon ? Math.floor(totalRamBytes * 0.75) : totalRamBytes

  const [gpuVramBytes, ollamaVersion, tagsResult, onDisk] = await Promise.all([
    isAppleSilicon ? Promise.resolve(null) : detectNvidiaVram(),
    detectOllamaVersion(),
    fetchInstalledModels(),
    detectOllamaOnDisk(),
  ])

  return {
    platform,
    arch,
    cpuCores,
    totalRamBytes,
    effectiveRamBytes,
    isAppleSilicon,
    gpuVramBytes,
    hasOllama: ollamaVersion !== null || tagsResult.up || onDisk,
    ollamaVersion,
    ollamaDaemonUp: tagsResult.up,
    installedModels: tagsResult.models,
  }
}
