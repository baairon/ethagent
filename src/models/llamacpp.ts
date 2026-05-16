import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { ensureConfigDir, getConfigDir } from '../storage/config.js'
import os from 'node:os'
import {
  buildFailure,
  formatInstallFailure,
  humanInstallError,
  installFailureDetail,
  installerProgressLabel,
  summarizeInstallOutput,
} from './llamacppOutput.js'
import {
  getLocalRunnerConfigPath,
  loadLocalRunnerConfig,
  saveLocalRunnerConfig,
  setLlamaCppServerPath,
  type LocalRunnerConfig,
} from './llamacppConfig.js'
import { runCommand } from './llamacppCommands.js'
import {
  detectLlamaCppServerBinary,
  discoverLlamaCppCliPaths,
  discoverLlamaCppServerPaths,
  findAndPersistLlamaCppServer,
} from './llamacppDiscovery.js'

export { humanInstallError, summarizeInstallOutput } from './llamacppOutput.js'
export {
  getLocalRunnerConfigPath,
  loadLocalRunnerConfig,
  saveLocalRunnerConfig,
  setLlamaCppServerPath,
} from './llamacppConfig.js'
export {
  detectLlamaCppServerBinary,
  discoverLlamaCppServerPaths,
  llamaCppSearchRoots,
  llamaCppServerCandidates,
} from './llamacppDiscovery.js'
export type { LocalRunnerConfig } from './llamacppConfig.js'

export const DEFAULT_LLAMA_HOST = process.env.LLAMACPP_HOST ?? 'http://localhost:8080'

export type LlamaCppStatus = {
  binaryPresent: boolean
  binaryPath: string | null
  version: string | null
  serverUp: boolean
  servedModels: string[]
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
  killRogue?: (host: string) => Promise<KillRogueResult>
  rogueDrainTimeoutMs?: number
  rogueDrainPollMs?: number
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
  onProgress?.({ phase: 'checking', label: 'checking local runner installers...', progress: 0.08 })
  for (const plan of plans) {
    onProgress?.({ phase: 'installing', label: installerProgressLabel(plan), progress: 0.34 })
    const result = await runInstallCommand(plan, plan.timeoutMs ?? 10 * 60_000)
    if (result.ok) {
      onProgress?.({ phase: 'finding', label: 'finding llama-server...', progress: 0.78 })
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

let cachedLlamaCppContextSize: number | null = null
const llamaCppContextSizeListeners = new Set<(size: number) => void>()

export async function fetchLlamaCppContextSize(
  host: string = DEFAULT_LLAMA_HOST,
  timeoutMs = 1500,
): Promise<number | null> {
  const response = await fetchWithTimeout(`${host.replace(/\/+$/, '')}/props`, timeoutMs)
  if (!response || !response.ok) return null
  try {
    const data = await response.json() as {
      n_ctx?: unknown
      default_generation_settings?: { n_ctx?: unknown }
    }
    const raw = typeof data.n_ctx === 'number'
      ? data.n_ctx
      : typeof data.default_generation_settings?.n_ctx === 'number'
        ? data.default_generation_settings.n_ctx
        : null
    if (typeof raw === 'number' && raw > 0) {
      const changed = cachedLlamaCppContextSize !== raw
      cachedLlamaCppContextSize = raw
      if (changed) {
        for (const listener of llamaCppContextSizeListeners) {
          try { listener(raw) } catch { void 0 }
        }
      }
      return raw
    }
    return null
  } catch {
    return null
  }
}

export function getCachedLlamaCppContextSize(): number | null {
  return cachedLlamaCppContextSize
}

export function setCachedLlamaCppContextSize(size: number): void {
  if (!(size > 0)) return
  const changed = cachedLlamaCppContextSize !== size
  cachedLlamaCppContextSize = size
  if (changed) {
    for (const listener of llamaCppContextSizeListeners) {
      try { listener(size) } catch { void 0 }
    }
  }
}

export function onLlamaCppContextSizeChange(listener: (size: number) => void): () => void {
  llamaCppContextSizeListeners.add(listener)
  return () => { llamaCppContextSizeListeners.delete(listener) }
}

export async function detectLlamaCpp(host: string = DEFAULT_LLAMA_HOST): Promise<LlamaCppStatus> {
  const [binary, serverUp] = await Promise.all([
    detectLlamaCppServerBinary(),
    isLlamaCppServerUp(host),
  ])
  const servedModels = serverUp ? await listServedModels(host) : []
  if (serverUp) void fetchLlamaCppContextSize(host)
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
  mmprojPath?: string
  readinessTimeoutMs?: number
  pollMs?: number
  deps?: LlamaCppStartDeps
}): Promise<LlamaCppStartResult> {
  const host = args.host ?? DEFAULT_LLAMA_HOST
  let initialStatus = await servedModelStatus(host, args.modelAlias)
  if (initialStatus.state === 'ready' && args.mmprojPath) {
    const pid = await readPidFile()
    if (!pid) {
      await (args.deps?.killRogue ?? killRogueLlamaProcesses)(host).catch(() => null)
      const drained = await waitForHostDown(host, args.deps?.rogueDrainTimeoutMs ?? 6000, args.deps?.rogueDrainPollMs ?? 200)
      if (!drained) {
        return startFailure('different-model-running', {
          servedModels: initialStatus.models,
          detail: 'another process is holding the local model port and could not be stopped automatically',
        })
      }
      initialStatus = await servedModelStatus(host, args.modelAlias)
    }
  }
  if (initialStatus.state === 'ready') {
    void fetchLlamaCppContextSize(host)
    return { ok: true, alreadyRunning: true }
  }
  if (initialStatus.state === 'different') {
    return startFailure('different-model-running', {
      servedModels: initialStatus.models,
    })
  }

  const accessFn = args.deps?.access ?? fs.access
  try {
    await accessFn(args.modelPath)
  } catch {
    return startFailure('model-file-missing', { detail: args.modelPath })
  }

  if (args.mmprojPath) {
    try {
      await accessFn(args.mmprojPath)
    } catch {
      return startFailure('model-file-missing', { detail: args.mmprojPath })
    }
  }

  const binaryPath = args.deps?.binaryPath ?? (await findAndPersistLlamaCppServer()).path
  if (!binaryPath) {
    return startFailure('runner-not-installed')
  }

  const url = new URL(host)
  const listenHost = url.hostname || '127.0.0.1'
  const port = url.port || (url.protocol === 'https:' ? '443' : '8080')
  const spawnImpl = args.deps?.spawnImpl ?? spawn
  const spawnArgs: string[] = [
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
    '--jinja',
  ]
  if (args.mmprojPath) spawnArgs.push('--mmproj', args.mmprojPath)
  let child: ReturnType<typeof spawn>
  try {
    child = spawnImpl(binaryPath, spawnArgs, {
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
  if (typeof child.pid === 'number') {
    await writePidFile(child.pid).catch(() => {})
  }

  const ready = await waitForServedModel({
    host,
    modelAlias: args.modelAlias,
    timeoutMs: args.readinessTimeoutMs ?? 90_000,
    pollMs: args.pollMs ?? 500,
    childFailure: () => childFailure,
  })
  if (ready.ok) {
    void fetchLlamaCppContextSize(host)
    return { ok: true, alreadyRunning: false }
  }
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

function pidFilePath(): string {
  return path.join(getConfigDir(), 'llamacpp.pid')
}

async function writePidFile(pid: number): Promise<void> {
  await ensureConfigDir()
  await atomicWriteText(pidFilePath(), String(pid))
}

async function readPidFile(): Promise<number | null> {
  try {
    const raw = await fs.readFile(pidFilePath(), 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function clearPidFile(): Promise<void> {
  await fs.rm(pidFilePath(), { force: true }).catch(() => {})
}

export async function stopLlamaCppServer(args: {
  host?: string
  timeoutMs?: number
  pollMs?: number
  killImpl?: (pid: number, signal?: NodeJS.Signals | number) => void
} = {}): Promise<
  | { ok: true; stopped: boolean; reason?: 'untracked-server'; servedModels?: string[] }
  | { ok: false; message: string }
> {
  const pid = await readPidFile()
  if (!pid) {
    const host = args.host ?? DEFAULT_LLAMA_HOST
    const { up, models } = await fetchServedModels(host, 1500)
    if (up && models.length > 0) {
      return { ok: true, stopped: false, reason: 'untracked-server', servedModels: models }
    }
    return { ok: true, stopped: false }
  }
  const kill = args.killImpl ?? ((p, signal) => process.kill(p, signal))
  try {
    kill(pid, 'SIGTERM')
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') {
      await clearPidFile()
      return { ok: true, stopped: false }
    }
    return { ok: false, message: (err as Error).message }
  }
  const host = args.host ?? DEFAULT_LLAMA_HOST
  const deadline = Date.now() + (args.timeoutMs ?? 5000)
  const pollMs = args.pollMs ?? 250
  while (Date.now() < deadline) {
    const status = await servedModelStatus(host, '__nothing__')
    if (status.state === 'not-up' || status.models.length === 0) {
      await clearPidFile()
      return { ok: true, stopped: true }
    }
    await new Promise<void>(resolve => setTimeout(resolve, pollMs))
  }
  await clearPidFile()
  return { ok: true, stopped: true }
}

async function waitForHostDown(host: string, timeoutMs: number, pollMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { up } = await fetchServedModels(host, 800)
    if (!up) return true
    await new Promise<void>(resolve => setTimeout(resolve, pollMs))
  }
  const { up } = await fetchServedModels(host, 800)
  return !up
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

export type KillRogueResult = { killed: number; errors: string[] }

export async function killRogueLlamaProcesses(host?: string): Promise<KillRogueResult> {
  const result: KillRogueResult = { killed: 0, errors: [] }
  try {
    await stopLlamaCppServer({ timeoutMs: 1500 })
  } catch (err: unknown) {
    result.errors.push(`tracked stop failed: ${(err as Error).message}`)
  }
  const platform = os.platform()
  const portOutcome = await killProcessOnPort(platform, host ?? DEFAULT_LLAMA_HOST)
  result.killed += portOutcome.killed
  if (portOutcome.error) result.errors.push(portOutcome.error)
  const targets = platform === 'win32'
    ? ['llama-server.exe', 'llama-cli.exe']
    : ['llama-server', 'llama-cli']
  for (const target of targets) {
    const outcome = await runKillCommand(platform, target)
    result.killed += outcome.killed
    if (outcome.error) result.errors.push(outcome.error)
  }
  await clearPidFile()
  return result
}

export async function killProcessOnPort(
  platform: NodeJS.Platform,
  host: string,
): Promise<{ killed: number; error?: string }> {
  const port = extractHostPort(host)
  if (!port) return { killed: 0, error: 'no port to scan' }
  const pids = await listListeningPids(platform, port)
  if (pids.length === 0) return { killed: 0 }
  let killed = 0
  const errors: string[] = []
  for (const pid of pids) {
    const outcome = await killByPid(platform, pid)
    if (outcome.killed) killed++
    if (outcome.error) errors.push(outcome.error)
  }
  return errors.length > 0 ? { killed, error: errors.join('; ') } : { killed }
}

function extractHostPort(host: string): number | null {
  try {
    const url = new URL(host)
    if (url.port) return Number.parseInt(url.port, 10)
    return url.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

async function listListeningPids(platform: NodeJS.Platform, port: number): Promise<number[]> {
  if (platform === 'win32') {
    const result = await runCommand('netstat', ['-ano', '-p', 'tcp'], 4000)
    if (!result) return []
    return parseNetstatPids(result.stdout, port)
  }
  const result = await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], 4000)
  if (!result || result.code !== 0) return []
  return result.stdout.split(/\r?\n/).map(line => Number.parseInt(line.trim(), 10)).filter(n => Number.isInteger(n) && n > 0)
}

export function parseNetstatPids(output: string, port: number): number[] {
  const pids: number[] = []
  const seen = new Set<number>()
  const portSuffix = `:${port}`
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || !line.toUpperCase().includes('LISTENING')) continue
    const cols = line.split(/\s+/)
    if (cols.length < 5) continue
    const local = cols[1] ?? ''
    if (!local.endsWith(portSuffix)) continue
    const pid = Number.parseInt(cols[cols.length - 1] ?? '', 10)
    if (!Number.isInteger(pid) || pid <= 0) continue
    if (pid === process.pid) continue
    if (seen.has(pid)) continue
    seen.add(pid)
    pids.push(pid)
  }
  return pids
}

async function killByPid(platform: NodeJS.Platform, pid: number): Promise<{ killed: boolean; error?: string }> {
  return new Promise(resolve => {
    const cmd = platform === 'win32' ? 'taskkill' : 'kill'
    const args = platform === 'win32' ? ['/F', '/T', '/PID', String(pid)] : ['-9', String(pid)]
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.on('error', err => resolve({ killed: false, error: `${cmd} ${pid}: ${err.message}` }))
    child.on('close', code => {
      if (code === 0) {
        resolve({ killed: true })
        return
      }
      resolve({ killed: false, error: `${cmd} ${pid} exited ${code}` })
    })
  })
}

async function runKillCommand(
  platform: NodeJS.Platform,
  target: string,
): Promise<{ killed: number; error?: string }> {
  return new Promise(resolve => {
    const cmd = platform === 'win32' ? 'taskkill' : 'pkill'
    const args = platform === 'win32'
      ? ['/F', '/T', '/IM', target]
      : ['-f', target]
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.on('error', err => resolve({ killed: 0, error: `${cmd} ${target}: ${err.message}` }))
    child.on('close', code => {
      if (code === 0) {
        resolve({ killed: 1 })
        return
      }
      if (platform === 'win32' && code === 128) {
        resolve({ killed: 0 })
        return
      }
      if (platform !== 'win32' && code === 1) {
        resolve({ killed: 0 })
        return
      }
      resolve({ killed: 0, error: `${cmd} ${target} exited ${code}` })
    })
  })
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
      return servedModels.length > 0
        ? `a different local model is already running (${servedModels.join(', ')}); stop it before switching models`
        : detail ?? 'a different local model is already running; stop it before switching models'
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

  onProgress?.({ phase: 'checking', label: 'checking build tools...', progress: 0.08 })
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
    onProgress?.({ phase: 'building', label: 'updating local runner source...', progress: 0.22 })
    const update = await runInstallCommand(
      { label: 'update llama.cpp source', command: 'git', args: ['-C', repoDir, 'pull', '--ff-only'], timeoutMs: 5 * 60_000 },
      5 * 60_000,
    )
    if (!update.ok) return buildFailure(update)
  } catch {
    onProgress?.({ phase: 'building', label: 'downloading local runner source...', progress: 0.22 })
    const clone = await runInstallCommand(
      { label: 'clone llama.cpp source', command: 'git', args: ['clone', '--depth', '1', 'https://github.com/ggml-org/llama.cpp.git', repoDir], timeoutMs: 10 * 60_000 },
      10 * 60_000,
    )
    if (!clone.ok) return buildFailure(clone)
  }

  onProgress?.({ phase: 'building', label: 'configuring local runner...', progress: 0.48 })
  const configure = await runInstallCommand(
    { label: 'configure llama.cpp', command: 'cmake', args: ['-S', repoDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release'], timeoutMs: 5 * 60_000 },
    5 * 60_000,
  )
  if (!configure.ok) return buildFailure(configure)

  onProgress?.({ phase: 'building', label: 'building local runner...', progress: 0.68 })
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
    onProgress?.({ phase: 'finding', label: 'local runner ready...', progress: 1 })
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
