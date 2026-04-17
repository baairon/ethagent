import React, { useEffect, useState } from 'react'
import { render, Box, Text } from 'ink'
import { isDaemonUp, listInstalled, pullModel, type InstalledModel, type PullProgress } from '../bootstrap/ollama.js'
import { loadConfig, saveConfig, defaultBaseUrlFor, type EthagentConfig } from '../config/store.js'
import { ProgressBar } from '../ui/ProgressBar.js'
import { theme } from '../ui/theme.js'

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)}GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)}MB`
}

function formatRow(name: string, size: string, modified: string, star: boolean): string {
  const prefix = star ? '*' : ' '
  return `${prefix} ${name.padEnd(32)}  ${size.padStart(7)}  ${modified}`
}

export async function runModelList(): Promise<number> {
  if (!(await isDaemonUp())) {
    process.stderr.write("ollama daemon isn't running. start ollama and retry.\n")
    return 1
  }
  const [models, config] = await Promise.all([listInstalled(), loadConfig()])
  if (models.length === 0) {
    process.stdout.write('no models installed. pull one with: ethagent model pull <name>\n')
    return 0
  }
  const activeModel = config?.provider === 'ollama' ? config.model : null
  process.stdout.write(formatRow('NAME', 'SIZE', 'MODIFIED', false) + '\n')
  for (const m of models) {
    const modified = m.modified ? new Date(m.modified).toISOString().slice(0, 10) : '—'
    process.stdout.write(formatRow(m.name, formatSize(m.sizeBytes), modified, m.name === activeModel) + '\n')
  }
  if (activeModel) {
    process.stdout.write(`\ndefault: ${activeModel} (marked *)\n`)
  }
  return 0
}

type PullPhase =
  | { kind: 'starting' }
  | { kind: 'progress'; status: string; completed: number; total: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

const PullView: React.FC<{
  name: string
  onExit: (code: number) => void
}> = ({ name, onExit }) => {
  const [phase, setPhase] = useState<PullPhase>({ kind: 'starting' })

  useEffect(() => {
    const controller = new AbortController()
    const onSigint = (): void => controller.abort()
    process.once('SIGINT', onSigint)

    let cancelled = false
    ;(async () => {
      try {
        let lastRender = 0
        for await (const event of pullModel(name, undefined, controller.signal)) {
          if (cancelled) return
          const completed = event.completed ?? 0
          const total = event.total ?? 0
          const now = Date.now()
          const isFinal = event.status === 'success' || !total
          if (isFinal || now - lastRender > 100) {
            lastRender = now
            setPhase({ kind: 'progress', status: event.status, completed, total })
          }
        }
        if (cancelled) return
        setPhase({ kind: 'done' })
        setTimeout(() => onExit(0), 50)
      } catch (err: unknown) {
        if (cancelled) return
        const message = controller.signal.aborted ? 'cancelled' : (err as Error).message
        setPhase({ kind: 'error', message })
        setTimeout(() => onExit(controller.signal.aborted ? 130 : 1), 50)
      }
    })()

    return () => {
      cancelled = true
      process.off('SIGINT', onSigint)
      controller.abort()
    }
  }, [name, onExit])

  if (phase.kind === 'starting') {
    return <Text color={theme.dim}>starting pull: {name}…</Text>
  }
  if (phase.kind === 'progress') {
    const progress = phase.total > 0 ? phase.completed / phase.total : 0
    const suffix = phase.total > 0 ? `${formatSize(phase.completed)} / ${formatSize(phase.total)}` : undefined
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>{phase.status}</Text>
        <ProgressBar progress={progress} label={name} suffix={suffix} />
      </Box>
    )
  }
  if (phase.kind === 'done') {
    return <Text color={theme.accentSecondary}>pulled {name}</Text>
  }
  return <Text color="#e87070">pull failed: {phase.message}</Text>
}

export async function runModelPull(name: string | undefined): Promise<number> {
  if (!name) {
    process.stderr.write('usage: ethagent model pull <name>\n')
    return 2
  }
  if (!(await isDaemonUp())) {
    process.stderr.write("ollama daemon isn't running. start ollama and retry.\n")
    return 1
  }
  return new Promise<number>(resolve => {
    const instance = render(<PullView name={name} onExit={code => {
      instance.unmount()
      resolve(code)
    }} />)
  })
}

export async function runModelUse(name: string | undefined): Promise<number> {
  if (!name) {
    process.stderr.write('usage: ethagent model use <name>\n')
    return 2
  }
  if (!(await isDaemonUp())) {
    process.stderr.write("ollama daemon isn't running. start ollama and retry.\n")
    return 1
  }
  const installed = await listInstalled()
  if (!installed.some(m => m.name === name)) {
    process.stderr.write(`model '${name}' isn't installed. run: ethagent model pull ${name}\n`)
    return 1
  }
  const existing = await loadConfig()
  const next: EthagentConfig = {
    version: 1,
    provider: 'ollama',
    model: name,
    baseUrl: defaultBaseUrlFor('ollama'),
    firstRunAt: existing?.firstRunAt ?? new Date().toISOString(),
  }
  await saveConfig(next)
  process.stdout.write(`default model set to ${name}\n`)
  return 0
}
