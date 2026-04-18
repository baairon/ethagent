import os from 'node:os'
import path from 'node:path'

export function compressHome(cwd: string): string {
  const home = os.homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + path.sep)) return '~' + cwd.slice(home.length).replace(/\\/g, '/')
  return cwd.replace(/\\/g, '/')
}
