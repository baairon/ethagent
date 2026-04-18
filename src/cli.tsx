#!/usr/bin/env node
import React, { useEffect, useState } from 'react'
import { render, Box, Text, useApp, useInput } from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PreviewSplash } from './ui/PreviewSplash.js'
import { theme } from './ui/theme.js'
import { FirstRun } from './bootstrap/FirstRun.js'
import { ChatScreen } from './ui/ChatScreen.js'
import { KeybindingProvider } from './keybindings/KeybindingProvider.js'
import { loadConfig, deleteConfig, getConfigPath, type EthagentConfig } from './storage/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json')
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
    '  ethagent           start the agent (first run triggers setup)',
    '  ethagent reset     wipe config (keys kept)',
    '  ethagent --version print version',
    '  ethagent --help    print this help',
    '',
    'inside the agent, type /help for slash commands.',
  ]
  for (const line of lines) process.stdout.write(line + '\n')
}

async function runResetCommand(): Promise<number> {
  await deleteConfig()
  process.stdout.write(`config removed: ${getConfigPath()}\n`)
  return 0
}

type AppPhase =
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'ready'; config: EthagentConfig }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

const AppRoot: React.FC<{ setExitCode: (code: number) => void }> = ({ setExitCode }) => {
  const [phase, setPhase] = useState<AppPhase>({ kind: 'loading' })
  const { exit } = useApp()

  useEffect(() => {
    if (phase.kind !== 'loading') return
    let cancelled = false
    loadConfig()
      .then(config => {
        if (cancelled) return
        setPhase(config ? { kind: 'ready', config } : { kind: 'setup' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPhase({ kind: 'error', message: (err as Error).message })
      })
    return () => { cancelled = true }
  }, [phase])

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

  useInput((input, key) => {
    if (phase.kind === 'ready') return
    if (key.ctrl && (input === 'c' || input === 'd')) exit()
  })

  if (phase.kind === 'loading') {
    return (
      <Box padding={1}>
        <Text color={theme.dim}>loading config…</Text>
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
        <Text color={theme.dim}>setup cancelled.</Text>
      </Box>
    )
  }
  if (phase.kind === 'error') {
    return (
      <Box padding={1}>
        <Text color="#e87070">error: {phase.message}</Text>
      </Box>
    )
  }
  return (
    <ChatScreen
      config={phase.config}
      onReplaceConfig={next => setPhase({ kind: 'ready', config: next })}
    />
  )
}

async function runDefault(): Promise<number> {
  let exitCode = 0
  const instance = render(
    <KeybindingProvider>
      <AppRoot setExitCode={code => { exitCode = code }} />
    </KeybindingProvider>,
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

async function runPreviewCommand(variant: string | undefined): Promise<number> {
  if (variant !== 'coming-soon') {
    process.stderr.write(`preview: unknown variant '${variant ?? ''}'\navailable: coming-soon\n`)
    return 2
  }
  const instance = render(<PreviewSplash />)
  await instance.waitUntilExit()
  return 0
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd) return runDefault()
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`ethagent ${readVersion()}\n`)
    return 0
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp()
    return 0
  }

  switch (cmd) {
    case 'reset':
      return runResetCommand()
    case 'preview':
      return runPreviewCommand(rest[0])
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
