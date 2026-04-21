import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let cwdState = normalizeExistingPath(process.cwd())

export function getCwd(): string {
  return cwdState
}

export function syncCwdFromProcess(): string {
  cwdState = normalizeExistingPath(process.cwd())
  return cwdState
}

export function setCwd(next: string, relativeTo = cwdState): string {
  const resolved = normalizeRequestedPath(next, relativeTo)
  process.chdir(resolved)
  cwdState = normalizeExistingPath(process.cwd())
  return cwdState
}

export function resolveUserPath(input: string, relativeTo = cwdState): string {
  return normalizeRequestedPath(input, relativeTo)
}

function normalizeRequestedPath(input: string, relativeTo: string): string {
  const expanded = input.startsWith('~')
    ? path.join(os.homedir(), input.slice(1))
    : input
  const resolved = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(relativeTo, expanded)
  return normalizeExistingPath(resolved)
}

function normalizeExistingPath(input: string): string {
  try {
    return fs.realpathSync.native(input)
  } catch {
    return path.resolve(input)
  }
}
