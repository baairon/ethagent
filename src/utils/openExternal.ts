import { spawn } from 'node:child_process'

export function openExternalUrl(url: string): void {
  const target = url.trim()
  if (!target) return

  if (process.platform === 'win32') {
    const safe = target.replace(/"/g, '%22')
    const child = spawn(
      'cmd.exe',
      ['/s', '/c', `start "" "${safe}"`],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    )
    child.on('error', () => {})
    child.unref()
    return
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [target], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => {})
  child.unref()
}
