#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cli = join(__dirname, '..', 'src', 'cli', 'main.tsx')

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
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('ethagent: dependencies are not installed. run npm install in the ethagent folder, then retry.\n')
    process.exit(1)
  }
  process.exit(typeof err?.status === 'number' ? err.status : 1)
}
