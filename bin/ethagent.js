#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cli = join(__dirname, '..', 'src', 'cli', 'main.tsx')

try {
  const tsxPath = import.meta.resolve('tsx/esm')
  execFileSync('node', ['--import', tsxPath, cli, ...process.argv.slice(2)], { stdio: 'inherit' })
} catch (err) {
  if (err?.code === 'ENOENT') {
    process.stderr.write('ethagent: node 20+ is required on PATH. install Node.js, then retry.\n')
    process.exit(127)
  }
  process.exit(typeof err?.status === 'number' ? err.status : 1)
}
