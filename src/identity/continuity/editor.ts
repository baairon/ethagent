import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export type EditorOpenResult =
  | { ok: true; method: string; waited: boolean }
  | { ok: false; error: string }

export type EditorCommand = {
  cmd: string
  args: string[]
  method: string
  waited: boolean
  shell?: boolean
}

export type EditorResolutionOptions = {
  platform?: NodeJS.Platform
  commandExists?: (command: string) => string | null
}

const IDE_CANDIDATES = ['code', 'cursor', 'windsurf'] as const

export function openFileInEditor(file: string, env: NodeJS.ProcessEnv = process.env): Promise<EditorOpenResult> {
  const command = resolveEditorCommand(file, env)
  if (command) return openEditorCommand(command)
  return openDefaultEditor(file)
}

export function resolveEditorCommand(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
  options: EditorResolutionOptions = {},
): EditorCommand | null {
  const platform = options.platform ?? process.platform
  const commandExists = options.commandExists ?? (command => findExecutable(command, env, platform))

  const ethagentEditor = env.ETHAGENT_EDITOR?.trim()
  if (ethagentEditor) return configuredCommand(ethagentEditor, file, true, platform)

  for (const candidate of IDE_CANDIDATES) {
    const executable = commandExists(candidate)
    if (executable) {
      return {
        cmd: executable,
        args: [file],
        method: candidate,
        waited: false,
        shell: platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable),
      }
    }
  }

  const configured = env.VISUAL?.trim() || env.EDITOR?.trim()
  if (configured) return configuredCommand(configured, file, true, platform)

  return defaultEditorCommand(file, platform)
}

function configuredCommand(commandLine: string, file: string, waited: boolean, platform: NodeJS.Platform): EditorCommand | null {
  const [cmd, ...args] = splitCommand(commandLine)
  if (!cmd) return null
  return {
    cmd,
    args: [...args, file],
    method: path.basename(cmd),
    waited,
    shell: platform === 'win32' && /\.(?:cmd|bat)$/i.test(cmd),
  }
}

function openEditorCommand(command: EditorCommand): Promise<EditorOpenResult> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command.cmd, command.args, command.waited
        ? { stdio: 'inherit', shell: command.shell }
        : { detached: true, stdio: 'ignore', shell: command.shell })
    } catch (err: unknown) {
      resolve({ ok: false, error: (err as Error).message })
      return
    }
    child.on('error', err => resolve({ ok: false, error: err.message }))
    if (!command.waited) {
      child.unref()
      resolve({ ok: true, method: command.method, waited: false })
      return
    }
    child.on('close', code => {
      if (code === 0) resolve({ ok: true, method: command.method, waited: true })
      else resolve({ ok: false, error: `${command.method} exited ${code}` })
    })
  })
}

function openDefaultEditor(file: string): Promise<EditorOpenResult> {
  const command = defaultEditorCommand(file)
  if (!command) return Promise.resolve({ ok: false, error: 'no default editor command for this platform' })
  return openEditorCommand(command)
}

function defaultEditorCommand(file: string, platform: NodeJS.Platform = process.platform): EditorCommand | null {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', file], method: 'cmd', waited: false }
  if (platform === 'darwin') return { cmd: 'open', args: [file], method: 'open', waited: false }
  return { cmd: 'xdg-open', args: [file], method: 'xdg-open', waited: false }
}

function splitCommand(commandLine: string): string[] {
  return commandLine.match(/"[^"]+"|'[^']+'|\S+/g)?.map(part => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return part.slice(1, -1)
    }
    return part
  }) ?? []
}

function findExecutable(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const hasPathSeparator = command.includes('/') || command.includes('\\')
  if (hasPathSeparator || path.isAbsolute(command)) {
    return canAccessExecutable(command) ? command : null
  }

  const pathValue = env.PATH ?? ''
  const pathParts = pathValue.split(path.delimiter).filter(Boolean)
  const extensions = platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']

  for (const dir of pathParts) {
    for (const ext of extensions) {
      const candidate = path.join(dir, platform === 'win32' && path.extname(command) === '' ? `${command}${ext.toLowerCase()}` : command)
      if (canAccessExecutable(candidate)) return candidate
      if (platform === 'win32') {
        const upperCandidate = path.join(dir, path.extname(command) === '' ? `${command}${ext.toUpperCase()}` : command)
        if (canAccessExecutable(upperCandidate)) return upperCandidate
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
