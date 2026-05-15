import { spawn } from 'node:child_process'

export type RunResult = {
  code: number
  stdout: string
  stderr: string
}

export function runCommand(cmd: string, args: string[], timeoutMs = 2000): Promise<RunResult | null> {
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

    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
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
