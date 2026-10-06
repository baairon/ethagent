import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.test-dist')
const coverage = process.argv.includes('--coverage')

await fs.rm(outDir, { recursive: true, force: true })

const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const compile = spawnSync(
  process.execPath,
  [tscBin, '--outDir', outDir, '--noEmit', 'false', ...(coverage ? ['--sourceMap', 'true'] : [])],
  { cwd: root, stdio: 'inherit' },
)

if (compile.status !== 0) {
  await fs.rm(outDir, { recursive: true, force: true })
  process.exit(compile.status ?? 1)
}

const coverageFlags = coverage
  ? [
      '--enable-source-maps',
      '--experimental-test-coverage',
      '--test-coverage-exclude=**/test/**',
      '--test-coverage-exclude=**/node_modules/**',
    ]
  : []

const run = spawnSync(
  process.execPath,
  [...coverageFlags, path.join(outDir, 'test', 'run.js')],
  { cwd: root, stdio: 'inherit' },
)

await fs.rm(outDir, { recursive: true, force: true })
process.exit(run.status ?? 1)
