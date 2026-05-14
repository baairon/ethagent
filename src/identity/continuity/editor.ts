import { spawn } from 'node:child_process'

type EditorOpenResult =
  | { ok: true; method: string; waited: boolean }
  | { ok: false; error: string }

type EditorCommand = {
  cmd: string
  args: string[]
  method: string
  waited: boolean
  shell?: boolean
}

export async function openFileInEditor(file: string): Promise<EditorOpenResult> {
  if (isVscodeEnvironment()) {
    const vscode = vscodeEditorCommand(file)
    const result = await openEditorCommand(vscode)
    if (result.ok) return result
  }
  const command = defaultEditorCommand(file)
  if (!command) return { ok: false, error: 'no default open command for this platform' }
  return openEditorCommand(command)
}

export async function openInFileManager(target: string): Promise<EditorOpenResult> {
  const command = defaultEditorCommand(target)
  if (!command) return { ok: false, error: 'no default open command for this platform' }
  return openEditorCommand(command)
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

export function defaultEditorCommand(file: string, platform: NodeJS.Platform = process.platform): EditorCommand | null {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', file], method: 'cmd', waited: false }
  if (platform === 'darwin') return { cmd: 'open', args: [file], method: 'open', waited: false }
  return { cmd: 'xdg-open', args: [file], method: 'xdg-open', waited: false }
}

export function isVscodeEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM_PROGRAM === 'vscode') return true
  if (env.VSCODE_PID) return true
  if (env.VSCODE_GIT_IPC_HANDLE) return true
  return false
}

export function vscodeEditorCommand(file: string, platform: NodeJS.Platform = process.platform): EditorCommand {
  if (platform === 'win32') {
    return { cmd: 'cmd', args: ['/c', 'code', '--reuse-window', file], method: 'vscode', waited: false }
  }
  return { cmd: 'code', args: ['--reuse-window', file], method: 'vscode', waited: false }
}
