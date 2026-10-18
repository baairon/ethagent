import { addGenericTarget } from './syncAdapters/generic.js'
import { runSync } from './sync.js'
import { loadConfig } from '../storage/config.js'
import { daemonLogPath, daemonStatus, ensureDaemon, isPaused, pauseSync, resumeSync, waitForDaemon } from './daemon.js'

export async function runEnsureDaemon(): Promise<number> {
  if (isPaused()) {
    process.stdout.write('ethagent: background sync paused\n')
    return 0
  }
  if (process.env.ETHAGENT_NO_DAEMON && !['0', 'false'].includes(process.env.ETHAGENT_NO_DAEMON.toLowerCase())) {
    process.stdout.write('ethagent: background sync disabled\n')
    return 0
  }
  let config: Awaited<ReturnType<typeof loadConfig>>
  try {
    config = await loadConfig()
  } catch (err) {
    process.stderr.write(`ethagent: could not read identity: ${(err as Error).message}\n`)
    return 1
  }
  if (!config?.identity) {
    process.stdout.write('ethagent: no identity yet\n')
    return 0
  }
  const current = daemonStatus()
  if (!current.running) ensureDaemon()
  const status = current.running ? current : await waitForDaemon()
  if (status.running) {
    process.stdout.write(`ethagent: background sync running (pid ${status.pid})\n`)
    return 0
  }
  process.stderr.write(`ethagent: background sync did not start; see ${daemonLogPath()}\n`)
  return 1
}

export async function runAddTool(args: string[]): Promise<number> {
  const rawPath = args[0]
  if (!rawPath) {
    process.stderr.write('usage: ethagent --add <path-to-instructions-file>\n')
    return 2
  }
  const resolved = await addGenericTarget(rawPath)
  const syncResult = await runSync({ quiet: true })
  const daemonResult = await runEnsureDaemon()
  if (syncResult !== 0) {
    process.stderr.write(`ethagent: added ${resolved}, but sync is incomplete; run ethagent sync after fixing the errors above\n`)
    return 1
  }
  if (daemonResult !== 0) {
    process.stderr.write(`ethagent: added ${resolved} and synced it, but background sync did not start\n`)
    return 1
  }
  process.stdout.write(`ethagent: added ${resolved} and synced your agent into it\n`)
  return 0
}

export async function runPause(): Promise<number> {
  pauseSync()
  process.stdout.write('ethagent: background sync paused; ethagent only syncs when you run it (resume with: ethagent resume)\n')
  return 0
}

export async function runResume(): Promise<number> {
  resumeSync()
  return runEnsureDaemon()
}
