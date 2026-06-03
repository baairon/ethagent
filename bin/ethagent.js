#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cli = join(__dirname, '..', 'src', 'cli', 'main.tsx')

// Only set the console code page for an interactive terminal; in the windowless daemon/hook
// path there is no TTY and spawning cmd would flash a console. windowsHide keeps any child
// from allocating a visible console window (grandchildren don't inherit it otherwise).
if (process.platform === 'win32' && process.stdout.isTTY) {
  try { execFileSync('cmd', ['/c', 'chcp', '65001'], { stdio: 'ignore', windowsHide: true }) } catch {}
}

try {
  const tsxPath = import.meta.resolve('tsx/esm')
  execFileSync('node', ['--import', tsxPath, cli, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true })
} catch (err) {
  if (err?.code === 'ENOENT') {
    process.stderr.write('ethagent: node 20+ is required on PATH. install Node.js, then retry.\n')
    process.exit(127)
  }
  process.exit(typeof err?.status === 'number' ? err.status : 1)
}
