#!/usr/bin/env node
import React, { useEffect, useState } from 'react'
import { render, Box, Text } from 'ink'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Splash } from './ui/splash.js'
import { theme } from './ui/theme.js'
import { FirstRun } from './bootstrap/firstRun.js'
import { loadConfig, deleteConfig, getConfigPath, type EthagentConfig } from './config/store.js'

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
    '  ethagent                      start the agent (first run triggers setup)',
    '  ethagent doctor               print diagnostics',
    '  ethagent config               print resolved config',
    '  ethagent reset                wipe config (keys kept)',
    '  ethagent model list           list installed ollama models',
    '  ethagent model pull <name>    pull an ollama model',
    '  ethagent model use <name>     set default model',
    '  ethagent key set <provider>   store API key (openai|anthropic|gemini)',
    '  ethagent key rm <provider>    remove stored key',
    '  ethagent --version            print version',
    '  ethagent --help               print this help',
  ]
  for (const line of lines) process.stdout.write(line + '\n')
}

async function runConfigCommand(): Promise<number> {
  const config = await loadConfig()
  if (!config) {
    process.stdout.write(`no config at ${getConfigPath()}\n`)
    return 1
  }
  process.stdout.write(JSON.stringify(config, null, 2) + '\n')
  process.stdout.write(`path: ${getConfigPath()}\n`)
  return 0
}

async function runResetCommand(): Promise<number> {
  await deleteConfig()
  process.stdout.write(`config removed: ${getConfigPath()}\n`)
  return 0
}

function notImplemented(command: string): number {
  process.stderr.write(`${command}: not implemented yet\n`)
  return 2
}

type AppPhase =
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'ready'; config: EthagentConfig }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

const AppRoot: React.FC<{ onExit: (code: number) => void }> = ({ onExit }) => {
  const [phase, setPhase] = useState<AppPhase>({ kind: 'loading' })

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
      const t = setTimeout(() => onExit(1), 10)
      return () => clearTimeout(t)
    }
    if (phase.kind === 'error') {
      const t = setTimeout(() => onExit(1), 10)
      return () => clearTimeout(t)
    }
    return undefined
  }, [phase, onExit])

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
    <Box flexDirection="column" padding={1}>
      <Splash statusLine={`ready · ${phase.config.provider} · ${phase.config.model}`} />
      <Text color={theme.dim}>chat coming soon. press ctrl+c to exit.</Text>
    </Box>
  )
}

function runDefault(): Promise<number> {
  return new Promise(resolve => {
    const instance = render(<AppRoot onExit={code => {
      instance.unmount()
      resolve(code)
    }} />)
  })
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
    case 'config':
      return runConfigCommand()
    case 'reset':
      return runResetCommand()
    case 'doctor':
      return notImplemented('doctor')
    case 'model':
      return notImplemented(`model ${rest[0] ?? ''}`.trim())
    case 'key':
      return notImplemented(`key ${rest[0] ?? ''}`.trim())
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
