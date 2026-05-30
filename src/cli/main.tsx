#!/usr/bin/env node
import React, { useEffect, useState } from 'react'
import { render, Box, Text, useApp } from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { theme } from '../ui/theme.js'
import { Spinner } from '../ui/Spinner.js'
import { KeybindingProvider } from '../app/keybindings/KeybindingProvider.js'
import { AppInputProvider } from '../app/input/AppInputProvider.js'
import { IdentityManager } from '../identity/manager/IdentityManager.js'
import type { IdentityManagerResult } from '../identity/manager/IdentityManager.js'
import { loadConfig, saveConfig, type EthagentConfig } from '../storage/config.js'
import { runSync, runSyncList, runSyncOnEdit } from './sync.js'
import { runStatus } from './status.js'
import { runResetCommand } from './reset.js'
import { enableDemoMode, synthDemoConfig } from './demo.js'

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
    '  ethagent reset              delete local identity, continuity, and secrets',
    '  ethagent --sync             sync soul, memory, and skills to every harness',
    '  ethagent --sync-to=<name>   sync only to a named adapter (claude-code, codex)',
    '  ethagent --sync-to=<path>   write per-skill folders under a custom path',
    '  ethagent --sync-list        list sync adapters and which ones detect here',
    '  ethagent --demo             walk identity with synthetic data',
    '  ethagent --status           print one-line identity summary',
    '  ethagent --version          print version',
    '  ethagent --help             print this help',
  ]
  for (const line of lines) process.stdout.write(line + '\n')
}

function valueFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  for (const a of argv) if (a.startsWith(prefix)) return a.slice(prefix.length)
  const idx = argv.indexOf(`--${name}`)
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1]!.startsWith('-')) return argv[idx + 1]
  return undefined
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
    <AppInputProvider>
      <KeybindingProvider>
        <Root setExit={n => { exitCode = n }} initialConfig={initialConfig} />
      </KeybindingProvider>
    </AppInputProvider>,
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
  if (flags.has('--sync-on-edit')) return runSyncOnEdit()
  if (flags.has('--sync-list')) return runSyncList()
  const syncTo = valueFlag(argv, 'sync-to')
  if (flags.has('--sync') || syncTo !== undefined) {
    return runSync(syncTo !== undefined ? { to: syncTo } : {})
  }
  if (flags.has('--status')) return runStatus(version)
  if (flags.has('--demo')) {
    enableDemoMode()
    return renderHub(synthDemoConfig())
  }
  if (argv[0] === 'reset') return runResetCommand(argv.slice(1))

  const unknown = argv.find(a => a.startsWith('-') && !a.startsWith('--sync-to'))
  if (unknown && !flags.has('--demo')) {
    process.stderr.write(`unknown flag: ${unknown}\nrun 'ethagent --help' for usage\n`)
    return 2
  }
  const positional = argv[0]
  if (positional) {
    process.stderr.write(`unknown command: ${positional}\nrun 'ethagent --help' for usage\n`)
    return 2
  }

  return renderHub(undefined)
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(1)
  })
