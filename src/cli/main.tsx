#!/usr/bin/env node
import React, { useEffect, useState } from 'react'
import { render, Box, Text, useApp } from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { theme } from '../ui/theme.js'
import { Spinner } from '../ui/Spinner.js'
import { KeybindingProvider } from '../app/keybindings/KeybindingProvider.js'
import { IdentityManager } from '../identity/manager/IdentityManager.js'
import type { IdentityManagerResult } from '../identity/manager/IdentityManager.js'
import { loadConfig, saveConfig, type EthagentConfig } from '../storage/config.js'
import { runSyncOnEdit } from './sync.js'
import { runMemoryGuard } from './memoryGuard.js'
import { runSkillGuard } from './skillGuard.js'
import { runPreToolGuard } from './pretoolGuard.js'
import { runSessionStart } from './sessionStart.js'
import { runStatus } from './status.js'
import { runVaultDir } from './vaultDir.js'
import { runResetCommand } from './reset.js'
import { runSave } from './save.js'
import { ensureBootstrapped } from './bootstrap.js'
import { ensureDaemon } from './daemon.js'
import { runWatch } from './watch.js'
import { runAddTool, runPause, runResume } from './prefs.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function printHelp(): void {
  const lines = [
    'ethagent: privacy-first AI agent with a portable Ethereum identity',
    '',
    'usage:',
    '  ethagent                    manage identity',
    '  ethagent save               back up your agent onchain (you approve in your wallet)',
    '  ethagent reset              delete local identity, continuity, and secrets',
    '  ethagent --add <path>       wire another tool by its config file (e.g. AGENTS.md)',
    '  ethagent pause              pause background sync (resume with: ethagent resume)',
    '  ethagent --status           print a one-line identity summary',
    "  ethagent --vault-dir        print this agent's vault directory path",
    '  ethagent --version          print version',
    '  ethagent --help             print this help',
  ]
  for (const line of lines) process.stdout.write(line + '\n')
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; config: EthagentConfig | null }
  | { kind: 'error'; message: string }

type RootProps = {
  setExit: (n: number) => void
  initialConfig: EthagentConfig | null | undefined
}

const Root: React.FC<RootProps> = ({ setExit, initialConfig }) => {
  const [phase, setPhase] = useState<Phase>(
    initialConfig !== undefined
      ? { kind: 'ready', config: initialConfig }
      : { kind: 'loading' },
  )
  const { exit } = useApp()

  useEffect(() => {
    if (phase.kind !== 'loading') return
    let cancelled = false
    loadConfig()
      .then(c => { if (!cancelled) setPhase({ kind: 'ready', config: c }) })
      .catch(err => { if (!cancelled) setPhase({ kind: 'error', message: (err as Error).message }) })
    return () => { cancelled = true }
  }, [phase.kind])

  if (phase.kind === 'loading') {
    return <Box padding={1}><Spinner label="loading identity..." showElapsed={false} /></Box>
  }
  if (phase.kind === 'error') {
    return <Box padding={1}><Text color={theme.accentError}>Error: {phase.message}</Text></Box>
  }

  const mode = phase.config?.identity ? 'manage' : 'first-run'
  const handleComplete = (result: IdentityManagerResult): void => {
    setExit(result.kind === 'cancel' ? 1 : 0)
    setTimeout(() => exit(), 10)
  }
  const handleConfigChange = (next: EthagentConfig): void => {
    setPhase({ kind: 'ready', config: next })
    void saveConfig(next)
  }

  return (
    <IdentityManager
      mode={mode}
      {...(phase.config ? { config: phase.config } : {})}
      onConfigChange={handleConfigChange}
      onComplete={handleComplete}
    />
  )
}

async function renderHub(initialConfig: EthagentConfig | null | undefined): Promise<number> {
  let exitCode = 0
  const instance = render(
    <KeybindingProvider>
      <Root setExit={n => { exitCode = n }} initialConfig={initialConfig} />
    </KeybindingProvider>,
    { exitOnCtrlC: false },
  )
  const guard = (reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason)
    process.stderr.write(`background error: ${message}\n`)
  }
  const onUnhandledRejection = (reason: unknown): void => guard(reason)
  const onUncaughtException = (err: unknown): void => guard(err)
  process.on('unhandledRejection', onUnhandledRejection)
  process.on('uncaughtException', onUncaughtException)
  try {
    await instance.waitUntilExit()
  } catch {
    exitCode = 1
  } finally {
    process.removeListener('unhandledRejection', onUnhandledRejection)
    process.removeListener('uncaughtException', onUncaughtException)
  }
  return exitCode
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = new Set(argv)
  const version = readVersion()

  if (flags.has('--version') || flags.has('-v')) {
    process.stdout.write(`ethagent ${version}\n`)
    return 0
  }
  if (flags.has('--help') || flags.has('-h') || argv[0] === 'help') {
    printHelp()
    return 0
  }
  // Hook flags must stay fast and side-effect-light; they wire nothing heavy here.
  if (flags.has('--sync-on-edit')) return runSyncOnEdit()
  if (flags.has('--session-start')) return runSessionStart()
  if (flags.has('--pretool-guard')) return runPreToolGuard()
  if (flags.has('--memory-guard')) return runMemoryGuard()
  if (flags.has('--skill-guard')) return runSkillGuard()
  // The shell-profile hook fires this on terminal open: bring the daemon up, then exit fast.
  if (flags.has('--ensure-daemon')) { ensureDaemon(); return 0 }

  // `watch` is the background sync engine ethagent spawns for itself; not a user command.
  if (argv[0] === 'watch') return runWatch(argv.slice(1))

  if (flags.has('--add')) return runAddTool(argv.filter(a => a !== '--add'))
  if (argv[0] === 'pause') return runPause()
  if (argv[0] === 'resume') return runResume()
  // --vault-dir is a pure read of config (no tool-wiring, no daemon), so resolve it before bootstrap.
  if (flags.has('--vault-dir')) return runVaultDir()

  // Normal invocations self-wire invisibly: set up tools (first run) and keep autosync alive.
  if (argv[0] !== 'reset') await ensureBootstrapped()

  if (flags.has('--status')) return runStatus(version)
  if (argv[0] === 'save') return runSave(argv.slice(1))
  if (flags.has('--save')) return runSave(argv.filter(a => a !== '--save'))
  if (argv[0] === 'reset') return runResetCommand(argv.slice(1))

  const unknown = argv.find(a => a.startsWith('-'))
  if (unknown) {
    process.stderr.write(`unknown flag: ${unknown}\nrun 'ethagent --help' for usage\n`)
    return 2
  }
  const positional = argv[0]
  if (positional) {
    process.stderr.write(`unknown command: ${positional}\nrun 'ethagent --help' for usage\n`)
    return 2
  }

  const exitCode = await renderHub(undefined)
  // Creating an identity in the manager should wire your tools right away, not on the next run.
  await ensureBootstrapped()
  return exitCode
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(1)
  })
