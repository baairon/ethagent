import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { ensureConfigDir, getConfigDir } from '../storage/config.js'
import os from 'node:os'

export const DEFAULT_LLAMA_HOST = process.env.LLAMACPP_HOST ?? 'http://localhost:8080'

export type LlamaCppStatus = {
  binaryPresent: boolean
  binaryPath: string | null
  version: string | null
  serverUp: boolean
  servedModels: string[]
}

type RunResult = {
  code: number
  stdout: string
  stderr: string
}

type RunInstallResult = { ok: true } | { ok: false; message: string; detail?: string }

export type LlamaCppInstallPhase = 'checking' | 'installing' | 'finding' | 'building'
export type LlamaCppInstallRecovery = 'retry-install' | 'source-build' | 'runner-path' | 'back'

export type LlamaCppInstallProgress = {
  phase: LlamaCppInstallPhase
  label: string
  progress: number
}

export type LlamaCppInstallResult =
  | { ok: true; serverPath?: string }
  | {
    ok: false
    code: 'install-failed' | 'server-not-found' | 'missing-tools' | 'build-failed'
    message: string
    detail?: string
    recovery: LlamaCppInstallRecovery[]
    candidatePaths?: string[]
  }

export type LlamaCppStartFailureCode =
  | 'runner-not-installed'
  | 'model-file-missing'
  | 'different-model-running'
  | 'spawn-failed'
  | 'runner-exited'
  | 'readiness-timeout'

export type LlamaCppStartResult =
  | { ok: true; alreadyRunning: boolean }
  | {
    ok: false
    code: LlamaCppStartFailureCode
    message: string
    detail?: string
    servedModels?: string[]
  }

export type LlamaCppInstallPlan = {
  command: string
  args: string[]
  label: string
  timeoutMs?: number
}

type LlamaCppStartDeps = {
  access?: typeof fs.access
  binaryPath?: string
  spawnImpl?: (command: string, args: readonly string[], options: NonNullable<Parameters<typeof spawn>[2]>) => ReturnType<typeof spawn>
}

export type LocalRunnerConfig = {
  llamaServerPath?: string
}

function runCommand(cmd: string, args: string[], timeoutMs = 2000): Promise<RunResult | null> {
  return new Promise(resolve => {
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch {
      resolve(null)
      return
    }

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { void 0 }
      resolve(null)
    }, timeoutMs)

    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

function runInstallCommand(
  plan: LlamaCppInstallPlan,
  timeoutMs: number,
): Promise<RunInstallResult> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(plan.command, plan.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ ok: false, message: (err as Error).message })
      return
    }

    let settled = false
    const settle = (result: RunInstallResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill() } catch { void 0 }
      resolve(result)
    }
    const timer = setTimeout(() => settle({ ok: false, message: `${plan.label} timed out` }), timeoutMs)
    let output = ''
    const onData = (chunk: Buffer | string): void => { output += chunk.toString() }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', err => settle({ ok: false, message: err.message }))
    child.on('close', code => {
      if (code === 0) settle({ ok: true })
      else settle({
        ok: false,
        message: humanInstallError(plan, code),
        detail: installFailureDetail(code, output),
      })
    })
  })
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function getLocalRunnerConfigPath(): string {
  return path.join(getConfigDir(), 'local-runner.json')
}

export async function loadLocalRunnerConfig(): Promise<LocalRunnerConfig> {
  try {
    const raw = await fs.readFile(getLocalRunnerConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const value = (parsed as { llamaServerPath?: unknown }).llamaServerPath
    return typeof value === 'string' && value.trim() ? { llamaServerPath: value.trim() } : {}
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return {}
  }
}

export async function saveLocalRunnerConfig(config: LocalRunnerConfig): Promise<void> {
  await ensureConfigDir()
  await atomicWriteText(getLocalRunnerConfigPath(), JSON.stringify(config, null, 2) + '\n')
}

export async function setLlamaCppServerPath(serverPath: string): Promise<void> {
  await saveLocalRunnerConfig({ llamaServerPath: serverPath.trim() })
}

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

export function llamaCppInstallPlans(platform: NodeJS.Platform = process.platform): LlamaCppInstallPlan[] {
  if (platform === 'win32') {
    return [
      {
        label: 'winget llama.cpp',
        command: 'winget',
        args: ['install', 'llama.cpp', '--accept-source-agreements', '--accept-package-agreements'],
      },
      {
        label: 'winget llama.cpp exact id',
        command: 'winget',
        args: ['install', '--id', 'ggml.llamacpp', '-e', '--accept-source-agreements', '--accept-package-agreements'],
      },
    ]
  }
  if (platform === 'darwin') {
    return [
      { label: 'brew llama.cpp', command: 'brew', args: ['install', 'llama.cpp'] },
      { label: 'nix llama.cpp', command: 'nix', args: ['profile', 'install', 'nixpkgs#llama-cpp'] },
      { label: 'macports llama.cpp', command: 'port', args: ['install', 'llama.cpp'] },
    ]
  }
  return [
    { label: 'brew llama.cpp', command: 'brew', args: ['install', 'llama.cpp'] },
    { label: 'nix llama.cpp', command: 'nix', args: ['profile', 'install', 'nixpkgs#llama-cpp'] },
  ]
}

export async function installLlamaCppRunner(
  onProgress?: (progress: LlamaCppInstallProgress) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<LlamaCppInstallResult> {
  const plans = llamaCppInstallPlans(platform)
  const failures: string[] = []
  onProgress?.({ phase: 'checking', label: 'checking local runner installers', progress: 0.08 })
  for (const plan of plans) {
    onProgress?.({ phase: 'installing', label: installerProgressLabel(plan), progress: 0.34 })
    const result = await runInstallCommand(plan, plan.timeoutMs ?? 10 * 60_000)
    if (result.ok) {
      onProgress?.({ phase: 'finding', label: 'finding llama-server', progress: 0.78 })
      const binary = await findAndPersistLlamaCppServer(platform)
      if (binary.path) return { ok: true, serverPath: binary.path }
      const cliPaths = await discoverLlamaCppCliPaths(process.env, platform)
      return {
        ok: false,
        code: 'server-not-found',
        message: 'llama.cpp installed, but the local server was not found.',
        detail: cliPaths.length > 0
          ? `Found llama-cli, but ethagent needs llama-server to run local chat.\n${cliPaths.slice(0, 3).join('\n')}`
          : 'The package manager finished, but it did not expose llama-server on this machine.',
        recovery: ['source-build', 'runner-path', 'retry-install', 'back'],
        candidatePaths: await discoverLlamaCppServerPaths(process.env, platform),
      }
    }
    failures.push(formatInstallFailure(plan.label, result))
  }
  return {
    ok: false,
    code: 'install-failed',
    message: failures.length > 0
      ? 'ethagent could not install the local runner automatically.'
      : 'no supported local runner installer was found for this platform.',
    detail: failures.join('\n'),
    recovery: ['retry-install', 'source-build', 'runner-path', 'back'],
  }
}

export async function buildLlamaCppRunner(
  onProgress?: (progress: LlamaCppInstallProgress) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<LlamaCppInstallResult> {
  return installLlamaCppFromSource(onProgress, platform)
}

export async function isLlamaCppServerUp(host: string = DEFAULT_LLAMA_HOST, timeoutMs = 800): Promise<boolean> {
  const response = await fetchServedModels(host, timeoutMs)
  return response.up
}

export async function listServedModels(host: string = DEFAULT_LLAMA_HOST): Promise<string[]> {
  const response = await fetchServedModels(host, 1500)
  return response.models
}

async function fetchServedModels(host: string = DEFAULT_LLAMA_HOST, timeoutMs = 1500): Promise<{ up: boolean; models: string[] }> {
  const response = await fetchWithTimeout(`${host.replace(/\/+$/, '')}/v1/models`, timeoutMs)
  if (!response || !response.ok) return { up: false, models: [] }
  try {
    const data = await response.json() as { data?: Array<{ id?: unknown }> }
    const models = (data.data ?? [])
      .map(item => typeof item.id === 'string' ? item.id : '')
      .filter(Boolean)
    return { up: true, models }
  } catch {
    return { up: true, models: [] }
  }
}

export async function detectLlamaCpp(host: string = DEFAULT_LLAMA_HOST): Promise<LlamaCppStatus> {
  const [binary, serverUp] = await Promise.all([
    detectLlamaCppServerBinary(),
    isLlamaCppServerUp(host),
  ])
  const servedModels = serverUp ? await listServedModels(host) : []
  return {
    binaryPresent: binary.path !== null,
    binaryPath: binary.path,
    version: binary.version,
    serverUp,
    servedModels,
  }
}

export async function startLlamaCppServer(args: {
  modelPath: string
  modelAlias: string
  host?: string
  ctxSize?: number
  readinessTimeoutMs?: number
  pollMs?: number
  deps?: LlamaCppStartDeps
}): Promise<LlamaCppStartResult> {
  const host = args.host ?? DEFAULT_LLAMA_HOST
  const initialStatus = await servedModelStatus(host, args.modelAlias)
  if (initialStatus.state === 'ready') return { ok: true, alreadyRunning: true }
  if (initialStatus.state === 'different') {
    return startFailure('different-model-running', {
      servedModels: initialStatus.models,
    })
  }

  try {
    await (args.deps?.access ?? fs.access)(args.modelPath)
  } catch {
    return startFailure('model-file-missing', { detail: args.modelPath })
  }

  const binaryPath = args.deps?.binaryPath ?? (await findAndPersistLlamaCppServer()).path
  if (!binaryPath) {
    return startFailure('runner-not-installed')
  }

  const url = new URL(host)
  const listenHost = url.hostname || '127.0.0.1'
  const port = url.port || (url.protocol === 'https:' ? '443' : '8080')
  const spawnImpl = args.deps?.spawnImpl ?? spawn
  let child: ReturnType<typeof spawn>
  try {
    child = spawnImpl(binaryPath, [
      '-m',
      args.modelPath,
      '--host',
      listenHost,
      '--port',
      port,
      '--alias',
      args.modelAlias,
      '--ctx-size',
      String(args.ctxSize ?? 32768),
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (err) {
    return startFailure('spawn-failed', { detail: (err as Error).message })
  }

  const capture = createStartupCapture(child)
  let childFailure: LlamaCppStartResult | null = null
  child.on('error', err => {
    childFailure = startFailure('spawn-failed', { detail: startupDetail(capture(), err.message) })
  })
  child.on('exit', (code, signal) => {
    childFailure ??= startFailure('runner-exited', {
      detail: startupDetail(capture(), `exit ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}`),
    })
  })
  child.unref()

  const ready = await waitForServedModel({
    host,
    modelAlias: args.modelAlias,
    timeoutMs: args.readinessTimeoutMs ?? 90_000,
    pollMs: args.pollMs ?? 500,
    childFailure: () => childFailure,
  })
  if (ready.ok) return { ok: true, alreadyRunning: false }
  if (ready.code === 'readiness-timeout') {
    return startFailure('readiness-timeout', { detail: capture() })
  }
  return ready
}

async function waitForServedModel(args: {
  host: string
  modelAlias: string
  timeoutMs: number
  pollMs: number
  childFailure: () => LlamaCppStartResult | null
}): Promise<{ ok: true } | Extract<LlamaCppStartResult, { ok: false }>> {
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    const status = await servedModelStatus(args.host, args.modelAlias)
    if (status.state === 'ready') return { ok: true }
    if (status.state === 'different') return startFailure('different-model-running', { servedModels: status.models })
    const failure = args.childFailure()
    if (failure && !failure.ok) return failure
    await new Promise<void>(resolve => setTimeout(resolve, args.pollMs))
  }

  for (let i = 0; i < 3; i++) {
    const status = await servedModelStatus(args.host, args.modelAlias)
    if (status.state === 'ready') return { ok: true }
    if (status.state === 'different') return startFailure('different-model-running', { servedModels: status.models })
    const failure = args.childFailure()
    if (failure && !failure.ok) return failure
    await new Promise<void>(resolve => setTimeout(resolve, args.pollMs))
  }

  return startFailure('readiness-timeout')
}

async function servedModelStatus(host: string, modelAlias: string): Promise<
  | { state: 'not-up'; models: string[] }
  | { state: 'ready'; models: string[] }
  | { state: 'different'; models: string[] }
> {
  const { up, models } = await fetchServedModels(host, 1500)
  if (!up) return { state: 'not-up', models }
  if (models.length === 0 || models.includes(modelAlias)) return { state: 'ready', models }
  return { state: 'different', models }
}

function startFailure(
  code: LlamaCppStartFailureCode,
  options: { detail?: string; servedModels?: string[] } = {},
): Extract<LlamaCppStartResult, { ok: false }> {
  const servedModels = options.servedModels?.filter(Boolean) ?? []
  return {
    ok: false,
    code,
    message: startFailureMessage(code, servedModels, options.detail),
    detail: options.detail || undefined,
    servedModels: servedModels.length > 0 ? servedModels : undefined,
  }
}

function startFailureMessage(code: LlamaCppStartFailureCode, servedModels: string[], detail?: string): string {
  switch (code) {
    case 'runner-not-installed':
      return 'local model runner is not installed yet'
    case 'model-file-missing':
      return detail ? `model file not found: ${detail}` : 'model file was not found'
    case 'different-model-running':
      return `a different local model is already running (${servedModels.join(', ')}); stop it before switching models`
    case 'spawn-failed':
      return 'local runner could not be started'
    case 'runner-exited':
      return 'local runner closed before becoming ready'
    case 'readiness-timeout':
      return 'local runner is still loading or did not answer in time'
  }
}

function createStartupCapture(child: ReturnType<typeof spawn>): () => string {
  let output = ''
  const capture = (chunk: Buffer | string): void => {
    output = `${output}${chunk.toString()}`.slice(-4000)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)
  return () => summarizeInstallOutput(output) ?? ''
}

function startupDetail(output: string, fallback: string): string {
  return output ? `${fallback}\n${output}` : fallback
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? ''
}

function appendCandidate(candidates: string[], candidate: string | undefined): void {
  if (!candidate || candidates.includes(candidate)) return
  candidates.push(candidate)
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

async function discoverLlamaCppCliPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  return discoverExecutablePaths(platform === 'win32' ? ['llama-cli.exe', 'llama-cli'] : ['llama-cli'], env, platform)
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

async function findAndPersistLlamaCppServer(
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

export function summarizeInstallOutput(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map(cleanInstallLine)
    .filter(Boolean)
    .filter(line => !/^[\-\\|/_.=\s]+$/.test(line))
    .filter(line => !/^\d+(\.\d+)?\s*(B|KB|MB|GB)\s*\/\s*\d+/i.test(line))
  const unique = [...new Set(lines)]
  return unique.slice(-6).join('\n') || undefined
}

export function humanInstallError(plan: LlamaCppInstallPlan, code: number | null): string {
  if (plan.command === 'winget') return 'Windows could not install the local runner automatically.'
  if (plan.command === 'brew') return 'Homebrew could not install the local runner automatically.'
  if (plan.command === 'nix') return 'Nix could not install the local runner automatically.'
  if (plan.command === 'port') return 'MacPorts could not install the local runner automatically.'
  if (plan.command === 'git') return 'ethagent could not download the local runner source.'
  if (plan.command === 'cmake') return 'ethagent could not build the local runner.'
  return code === null
    ? `${plan.label} did not complete.`
    : `${plan.label} failed with exit code ${code}.`
}

function installFailureDetail(code: number | null, output: string): string | undefined {
  const details = [
    code === null ? undefined : `exit code ${code}`,
    summarizeInstallOutput(output),
  ].filter((item): item is string => Boolean(item))
  return details.join('\n') || undefined
}

function cleanInstallLine(line: string): string {
  return line
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function installerProgressLabel(plan: LlamaCppInstallPlan): string {
  if (plan.command === 'winget') return 'installing with Windows package manager'
  if (plan.command === 'brew') return 'installing with Homebrew'
  if (plan.command === 'nix') return 'installing with Nix'
  if (plan.command === 'port') return 'installing with MacPorts'
  return `installing with ${plan.label}`
}

function formatInstallFailure(label: string, result: RunInstallResult): string {
  if (result.ok) return label
  return [label, result.message, result.detail].filter(Boolean).join(': ')
}

function buildFailure(result: RunInstallResult): LlamaCppInstallResult {
  return {
    ok: false,
    code: 'build-failed',
    message: 'ethagent could not build the local runner.',
    detail: result.ok ? undefined : [result.message, result.detail].filter(Boolean).join('\n'),
    recovery: ['runner-path', 'retry-install', 'back'],
  }
}

function sourceBuildServerCandidates(buildDir: string, platform: NodeJS.Platform): string[] {
  const exe = platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return [
    path.join(buildDir, 'bin', exe),
    path.join(buildDir, 'bin', 'Release', exe),
    path.join(buildDir, 'bin', 'Debug', exe),
    path.join(buildDir, 'Release', exe),
    path.join(buildDir, 'Debug', exe),
  ]
}

async function firstAccessible(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

async function installLlamaCppFromSource(
  onProgress?: (progress: LlamaCppInstallProgress) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<LlamaCppInstallResult> {
  const root = path.join(getConfigDir(), 'runners')
  const repoDir = path.join(root, 'llama.cpp')
  const buildDir = path.join(repoDir, 'build')
  const serverPath = path.join(buildDir, 'bin', platform === 'win32' ? 'llama-server.exe' : 'llama-server')
  await ensureConfigDir()
  await fs.mkdir(root, { recursive: true })

  onProgress?.({ phase: 'checking', label: 'checking build tools', progress: 0.08 })
  const hasGit = await runCommand('git', ['--version'])
  if (!hasGit || hasGit.code !== 0) {
    return {
      ok: false,
      code: 'missing-tools',
      message: 'git is required to build the local runner.',
      recovery: ['runner-path', 'retry-install', 'back'],
    }
  }
  const hasCmake = await runCommand('cmake', ['--version'])
  if (!hasCmake || hasCmake.code !== 0) {
    return {
      ok: false,
      code: 'missing-tools',
      message: 'cmake is required to build the local runner.',
      recovery: ['runner-path', 'retry-install', 'back'],
    }
  }

  try {
    await fs.access(path.join(repoDir, '.git'))
    onProgress?.({ phase: 'building', label: 'updating local runner source', progress: 0.22 })
    const update = await runInstallCommand(
      { label: 'update llama.cpp source', command: 'git', args: ['-C', repoDir, 'pull', '--ff-only'], timeoutMs: 5 * 60_000 },
      5 * 60_000,
    )
    if (!update.ok) return buildFailure(update)
  } catch {
    onProgress?.({ phase: 'building', label: 'downloading local runner source', progress: 0.22 })
    const clone = await runInstallCommand(
      { label: 'clone llama.cpp source', command: 'git', args: ['clone', '--depth', '1', 'https://github.com/ggml-org/llama.cpp.git', repoDir], timeoutMs: 10 * 60_000 },
      10 * 60_000,
    )
    if (!clone.ok) return buildFailure(clone)
  }

  onProgress?.({ phase: 'building', label: 'configuring local runner', progress: 0.48 })
  const configure = await runInstallCommand(
    { label: 'configure llama.cpp', command: 'cmake', args: ['-S', repoDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release'], timeoutMs: 5 * 60_000 },
    5 * 60_000,
  )
  if (!configure.ok) return buildFailure(configure)

  onProgress?.({ phase: 'building', label: 'building local runner', progress: 0.68 })
  const build = await runInstallCommand(
    {
      label: 'build llama-server',
      command: 'cmake',
      args: ['--build', buildDir, '--config', 'Release', '--target', 'llama-server', '-j', String(Math.max(1, os.cpus().length - 1))],
      timeoutMs: 30 * 60_000,
    },
    30 * 60_000,
  )
  if (!build.ok) return buildFailure(build)

  const builtServerPath = await firstAccessible(sourceBuildServerCandidates(buildDir, platform))
    ?? (await discoverLlamaCppServerPaths(process.env, platform))[0]
  if (builtServerPath) {
    await setLlamaCppServerPath(builtServerPath)
    onProgress?.({ phase: 'finding', label: 'local runner ready', progress: 1 })
    return { ok: true, serverPath: builtServerPath }
  }

  return {
    ok: false,
    code: 'server-not-found',
    message: 'built the local runner, but llama-server was not found.',
    detail: serverPath,
    recovery: ['runner-path', 'retry-install', 'back'],
    candidatePaths: sourceBuildServerCandidates(buildDir, platform),
  }
}
