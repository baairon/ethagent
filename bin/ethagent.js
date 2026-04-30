#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cli = join(__dirname, '..', 'src', 'cli', 'main.tsx')

try {
  execFileSync('node', ['--import', 'tsx/esm', cli, ...process.argv.slice(2)], { stdio: 'inherit' })
} catch (err) {
  process.exit(typeof err?.status === 'number' ? err.status : 1)
}
