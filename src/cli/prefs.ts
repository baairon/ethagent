import { addGenericTarget } from './syncAdapters/generic.js'
import { runSync } from './sync.js'
import { ensureDaemon, pauseSync, resumeSync } from './daemon.js'

export async function runAddTool(args: string[]): Promise<number> {
  const rawPath = args[0]
  if (!rawPath) {
    process.stderr.write('usage: ethagent --add <path-to-instructions-file>\n')
    return 2
  }
  const resolved = await addGenericTarget(rawPath)
  await runSync({ quiet: true })
  ensureDaemon()
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
  ensureDaemon()
  process.stdout.write('ethagent: background sync resumed\n')
  return 0
}
