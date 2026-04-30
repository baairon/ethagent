import os from 'node:os'
import { spawn } from 'node:child_process'

export type SpecSnapshot = {
  platform: NodeJS.Platform
  arch: string
  cpuCores: number
  totalRamBytes: number
  effectiveRamBytes: number
  isAppleSilicon: boolean
  gpuVramBytes: number | null
}

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

async function detectNvidiaVram(): Promise<number | null> {
  const result = await runCommand('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'])
  if (!result || result.code !== 0) return null
  const firstLine = result.stdout.split('\n').map(l => l.trim()).find(Boolean)
  if (!firstLine) return null
  const mib = Number.parseInt(firstLine, 10)
  if (!Number.isFinite(mib) || mib <= 0) return null
  return mib * 1024 * 1024
}

export async function detectSpec(): Promise<SpecSnapshot> {
  const platform = process.platform
  const arch = process.arch
  const cpuCores = os.cpus().length
  const totalRamBytes = os.totalmem()
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64'
  const effectiveRamBytes = isAppleSilicon ? Math.floor(totalRamBytes * 0.75) : totalRamBytes

  const [gpuVramBytes] = await Promise.all([
    isAppleSilicon ? Promise.resolve(null) : detectNvidiaVram(),
  ])

  return {
    platform,
    arch,
    cpuCores,
    totalRamBytes,
    effectiveRamBytes,
    isAppleSilicon,
    gpuVramBytes,
  }
}
