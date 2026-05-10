import { spawn } from 'node:child_process'

export function openExternalUrl(url: string): void {
  const target = url.trim()
  if (!target) return
  const command = process.platform === 'win32'
    ? 'cmd'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open'
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', target]
    : [target]
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on('error', () => {})
  child.unref()
}
