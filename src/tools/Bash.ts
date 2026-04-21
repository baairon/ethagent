import path from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { Tool } from './contracts.js'
import { assessBashCommand, validateBashCommandInput } from './bashSafety.js'
import { resolveWorkspacePath } from './Read.js'

const schema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
})

export const bashTool: Tool<typeof schema> = {
  name: 'run_bash',
  kind: 'bash',
  description: 'Run a shell command in the current workspace and return stdout, stderr, and the exit code.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run.' },
      cwd: { type: 'string', description: 'Optional working directory inside the workspace.' },
    },
    required: ['command'],
  },
  parse(input) {
    const parsed = schema.parse(input)
    const validationError = validateBashCommandInput(parsed.command)
    if (validationError) {
      throw new Error(validationError)
    }
    return parsed
  },
  async buildPermissionRequest(input, context) {
    const cwd = input.cwd ? resolveWorkspacePath(context.workspaceRoot, input.cwd) : context.workspaceRoot
    const safety = assessBashCommand(input.command)
    return {
      kind: 'bash',
      command: input.command,
      commandPrefix: safety.commandPrefix,
      cwd,
      title: 'allow shell command?',
      subtitle: `${input.command}\n${cwd}`,
      warning: safety.warning,
      canPersistExact: safety.canPersistExact,
      canPersistPrefix: safety.canPersistPrefix,
    }
  },
  async execute(input, context) {
    const cwd = input.cwd ? resolveWorkspacePath(context.workspaceRoot, input.cwd) : context.workspaceRoot
    const output = await runCommand(input.command, cwd, context.abortSignal)
    const relativeCwd = path.relative(context.workspaceRoot, cwd) || '.'
    const stdout = output.stdout.trim()
    const stderr = output.stderr.trim()
    const parts = [
      `cwd: ${relativeCwd}`,
      `exit: ${output.exitCode}`,
      stdout ? `stdout:\n${truncate(stdout)}` : '',
      stderr ? `stderr:\n${truncate(stderr)}` : '',
    ].filter(Boolean)
    return {
      ok: output.exitCode === 0,
      summary: `ran ${input.command}`,
      content: parts.join('\n\n'),
    }
  },
}

function runCommand(
  command: string,
  cwd: string,
  abortSignal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error('command cancelled'))
      return
    }

    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
    })
    let settled = false
    const timeout = setTimeout(() => {
      killChildProcessTree(child.pid)
    }, 60_000)
    let stdout = ''
    let stderr = ''
    const onAbort = () => {
      cleanup()
      killChildProcessTree(child.pid)
      if (!settled) {
        settled = true
        reject(new Error('command cancelled'))
      }
    }
    const cleanup = () => {
      clearTimeout(timeout)
      abortSignal?.removeEventListener('abort', onAbort)
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      cleanup()
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', code => {
      cleanup()
      if (settled) return
      settled = true
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })
  })
}

function killChildProcessTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
    killer.on('error', () => {})
    killer.unref()
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
  }
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
