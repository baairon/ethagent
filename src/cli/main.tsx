#!/usr/bin/env node
import React, { useEffect, useState } from 'react'
import { render, Box, Text, useApp } from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { theme } from '../ui/theme.js'
import { FirstRun } from '../app/FirstRun.js'
import { ChatScreen } from '../chat/ChatScreen.js'
import { KeybindingProvider } from '../app/keybindings/KeybindingProvider.js'
import { AppInputProvider, useAppInput } from '../app/input/AppInputProvider.js'
import { loadConfig, type EthagentConfig } from '../storage/config.js'
import { runResetCommand } from './reset.js'
import { runPreviewCommand } from './preview.js'
import { checkForUpdates } from './updateNotice.js'
import { Spinner } from '../ui/Spinner.js'
import { TITLE_STATIC, clearTerminalTitle, setTerminalTitle } from '../ui/terminalTitle.js'

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
    '  ethagent             start the agent (first run triggers setup)',
    '  ethagent preview     show the brand splash and exit',
    '  ethagent reset       factory reset local data (local LLMs kept)',
    '  ethagent reset --yes run reset without the confirm prompt',
    '  ethagent --version   print version',
    '  ethagent --help      print this help',
    '',
    'inside the agent, type /help for slash commands.',
  ]
  for (const line of lines) process.stdout.write(line + '\n')
}

type AppPhase =
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'ready'; config: EthagentConfig }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

const MIN_STARTUP_SPINNER_MS = 480

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const AppRoot: React.FC<{ setExitCode: (code: number) => void; currentVersion: string }> = ({ setExitCode, currentVersion }) => {
  const [phase, setPhase] = useState<AppPhase>({ kind: 'loading' })
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const { exit } = useApp()

  useEffect(() => {
    if (phase.kind !== 'loading') return
    let cancelled = false
    Promise.all([loadConfig(), delay(MIN_STARTUP_SPINNER_MS)])
      .then(config => {
        if (cancelled) return
        setPhase(config[0] ? { kind: 'ready', config: config[0] } : { kind: 'setup' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPhase({ kind: 'error', message: (err as Error).message })
      })
    return () => { cancelled = true }
  }, [phase])

  useEffect(() => {
    let cancelled = false
    void checkForUpdates(currentVersion)
      .then(notice => {
        if (!cancelled) setUpdateNotice(notice)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentVersion])

  useEffect(() => {
    setTerminalTitle(TITLE_STATIC)
  }, [])

  useEffect(() => {
    if (phase.kind === 'cancelled') {
      setExitCode(1)
      const t = setTimeout(() => exit(), 10)
      return () => clearTimeout(t)
    }
    if (phase.kind === 'error') {
      setExitCode(1)
      const t = setTimeout(() => exit(), 10)
      return () => clearTimeout(t)
    }
    return undefined
  }, [phase, exit, setExitCode])

  useAppInput((input, key) => {
    if (phase.kind === 'ready') return
    if (key.ctrl && (input === 'c' || input === 'd')) {
      if (phase.kind === 'setup') {
        setPhase({ kind: 'cancelled' })
      } else {
        exit()
      }
    }
  })

  if (phase.kind === 'loading') {
    return (
      <Box padding={1}>
        <Spinner label="starting ethagent..." showElapsed={false} />
      </Box>
    )
  }
  if (phase.kind === 'setup') {
    return (
      <FirstRun
        onComplete={config => setPhase({ kind: 'ready', config })}
        onCancel={() => setPhase({ kind: 'cancelled' })}
      />
    )
  }
  if (phase.kind === 'cancelled') {
    return (
      <Box padding={1}>
        <Text color={theme.dim}>Setup cancelled.</Text>
      </Box>
    )
  }
  if (phase.kind === 'error') {
    return (
      <Box padding={1}>
        <Text color={theme.accentError}>Error: {phase.message}</Text>
      </Box>
    )
  }
  return (
    <ChatScreen
      config={phase.config}
      onReplaceConfig={next => setPhase({ kind: 'ready', config: next })}
      updateNotice={updateNotice}
    />
  )
}

async function runDefault(currentVersion: string): Promise<number> {
  let exitCode = 0
  setTerminalTitle(TITLE_STATIC)
  process.once('exit', clearTerminalTitle)
  const instance = render(
    <AppInputProvider>
      <KeybindingProvider>
        <AppRoot setExitCode={code => { exitCode = code }} currentVersion={currentVersion} />
      </KeybindingProvider>
    </AppInputProvider>,
    {
      exitOnCtrlC: false,
    },
  )
  try {
    await instance.waitUntilExit()
  } catch {
    exitCode = 1
  }
  return exitCode
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd) return runDefault(readVersion())
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`ethagent ${readVersion()}\n`)
    return 0
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp()
    return 0
  }

  switch (cmd) {
    case 'preview':
      return runPreviewCommand()
    case 'reset':
      return runResetCommand(rest)
    default:
      process.stderr.write(`unknown command: ${cmd}\nrun 'ethagent --help' for usage\n`)
      return 2
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(1)
  })
