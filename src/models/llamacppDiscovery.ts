import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir } from '../storage/config.js'
import {
  loadLocalRunnerConfig,
  setLlamaCppServerPath,
} from './llamacppConfig.js'
import { runCommand } from './llamacppCommands.js'

export async function detectLlamaCppServerBinary(extraCandidates: string[] = []): Promise<{ path: string | null; version: string | null }> {
  const config = await loadLocalRunnerConfig()
  const candidates = [
    ...llamaCppServerCandidates(process.env, process.platform, config.llamaServerPath),
    ...extraCandidates,
  ]
  for (const candidate of candidates) {
    const result = await runCommand(candidate, ['--version'])
    if (!result) continue
    const output = `${result.stdout}\n${result.stderr}`.trim()
    if (result.code === 0 || output.length > 0) {
      return { path: candidate, version: firstLine(output) || 'installed' }
    }
  }
  return { path: null, version: null }
}

export function llamaCppServerCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  configuredPath?: string,
): string[] {
  const candidates: string[] = []
  appendCandidate(candidates, configuredPath)
  appendCandidate(candidates, env.LLAMA_SERVER_PATH)
  appendCandidate(candidates, env.LLAMACPP_SERVER_PATH)
  appendCandidate(candidates, 'llama-server')
  appendCandidate(candidates, 'llama-server.exe')

  if (platform === 'win32') {
    appendCandidate(candidates, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'llama.cpp', 'llama-server.exe') : undefined)
    appendCandidate(candidates, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'llama.cpp', 'llama-server.exe') : undefined)
    appendCandidate(candidates, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'llama-server.exe') : undefined)
    appendCandidate(candidates, env.ProgramFiles ? path.join(env.ProgramFiles, 'llama.cpp', 'llama-server.exe') : undefined)
    appendCandidate(candidates, env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)'], 'llama.cpp', 'llama-server.exe') : undefined)
    appendCandidate(candidates, env.USERPROFILE ? path.join(env.USERPROFILE, 'scoop', 'shims', 'llama-server.exe') : undefined)
    appendCandidate(candidates, env.USERPROFILE ? path.join(env.USERPROFILE, 'scoop', 'apps', 'llama.cpp', 'current', 'llama-server.exe') : undefined)
  } else if (platform === 'darwin') {
    appendCandidate(candidates, '/opt/homebrew/bin/llama-server')
    appendCandidate(candidates, '/usr/local/bin/llama-server')
    appendCandidate(candidates, '/opt/local/bin/llama-server')
    appendCandidate(candidates, env.HOME ? path.join(env.HOME, '.nix-profile', 'bin', 'llama-server') : undefined)
    appendCandidate(candidates, env.HOME ? path.join(env.HOME, '.local', 'bin', 'llama-server') : undefined)
  } else {
    appendCandidate(candidates, '/usr/local/bin/llama-server')
    appendCandidate(candidates, '/usr/bin/llama-server')
    appendCandidate(candidates, env.HOME ? path.join(env.HOME, '.nix-profile', 'bin', 'llama-server') : undefined)
    appendCandidate(candidates, env.HOME ? path.join(env.HOME, '.local', 'bin', 'llama-server') : undefined)
  }

  return candidates
}

export function llamaCppSearchRoots(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const roots: string[] = []
  if (platform === 'win32') {
    appendCandidate(roots, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : undefined)
    appendCandidate(roots, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps') : undefined)
    appendCandidate(roots, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'llama.cpp') : undefined)
    appendCandidate(roots, env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'llama.cpp') : undefined)
    appendCandidate(roots, env.ProgramFiles ? path.join(env.ProgramFiles, 'llama.cpp') : undefined)
    appendCandidate(roots, env.ProgramFiles ? path.join(env.ProgramFiles, 'WindowsApps') : undefined)
    appendCandidate(roots, env.USERPROFILE ? path.join(env.USERPROFILE, 'scoop', 'apps', 'llama.cpp') : undefined)
    appendCandidate(roots, env.USERPROFILE ? path.join(env.USERPROFILE, 'scoop', 'shims') : undefined)
    appendCandidate(roots, path.join(getConfigDir(), 'runners', 'llama.cpp', 'build'))
    appendCandidate(roots, path.join(getConfigDir(), 'runners', 'llama.cpp', 'build', 'bin'))
    return roots
  }

  appendCandidate(roots, '/opt/homebrew/bin')
  appendCandidate(roots, '/usr/local/bin')
  appendCandidate(roots, '/opt/local/bin')
  appendCandidate(roots, '/usr/bin')
  appendCandidate(roots, env.HOME ? path.join(env.HOME, '.nix-profile', 'bin') : undefined)
  appendCandidate(roots, env.HOME ? path.join(env.HOME, '.local', 'bin') : undefined)
  appendCandidate(roots, path.join(getConfigDir(), 'runners', 'llama.cpp', 'build'))
  appendCandidate(roots, path.join(getConfigDir(), 'runners', 'llama.cpp', 'build', 'bin'))
  return roots
}

export async function discoverLlamaCppServerPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  return discoverExecutablePaths(platform === 'win32' ? ['llama-server.exe', 'llama-server'] : ['llama-server'], env, platform)
}

export async function discoverLlamaCppCliPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  return discoverExecutablePaths(platform === 'win32' ? ['llama-cli.exe', 'llama-cli'] : ['llama-cli'], env, platform)
}

export async function findAndPersistLlamaCppServer(
  platform: NodeJS.Platform = process.platform,
): Promise<{ path: string | null; version: string | null }> {
  const direct = await detectLlamaCppServerBinary()
  if (direct.path) return direct
  const discovered = await discoverLlamaCppServerPaths(process.env, platform)
  const found = await detectLlamaCppServerBinary(discovered)
  if (found.path) {
    await setLlamaCppServerPath(found.path).catch(() => {})
  }
  return found
}

async function discoverExecutablePaths(
  names: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string[]> {
  const found: string[] = []
  const lowered = new Set(names.map(name => name.toLowerCase()))
  for (const root of llamaCppSearchRoots(env, platform)) {
    await walkForExecutable(root, lowered, found, 0, 5)
    if (found.length >= 20) break
  }
  return found
}

async function walkForExecutable(
  dir: string,
  names: Set<string>,
  found: string[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth > maxDepth || found.length >= 20) return
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (found.length >= 20) return
    const fullPath = path.join(dir, entry.name)
    const lowerName = entry.name.toLowerCase()
    if ((entry.isFile() || entry.isSymbolicLink()) && names.has(lowerName)) {
      appendCandidate(found, fullPath)
      continue
    }
    if (entry.isDirectory() && shouldDescendRunnerDir(entry.name, depth)) {
      await walkForExecutable(fullPath, names, found, depth + 1, maxDepth)
    }
  }
}

function shouldDescendRunnerDir(name: string, depth: number): boolean {
  const lower = name.toLowerCase()
  if (/(llama|ggml|bin|build|release|debug|current|package|windowsapps|x64|arm64)/.test(lower)) return true
  return depth > 0 && lower.length <= 24
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? ''
}

function appendCandidate(candidates: string[], candidate: string | undefined): void {
  if (!candidate || candidates.includes(candidate)) return
  candidates.push(candidate)
}
