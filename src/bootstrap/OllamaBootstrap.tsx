import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { Select } from '../ui/Select.js'
import { ProgressBar } from '../ui/ProgressBar.js'
import { Spinner } from '../ui/Spinner.js'
import { theme } from '../ui/theme.js'
import {
  isDaemonUp,
  listInstalled,
  startDaemon,
  installOllama,
  pullModel,
} from './ollama.js'
import { qwenLadder, recommendModel } from './modelRecommendation.js'
import type { SpecSnapshot } from './runtimeDetection.js'

type ModelChoice = {
  name: string
  installed: boolean
  approxGB?: number
  recommended?: boolean
}

type Phase =
  | { kind: 'detecting' }
  | { kind: 'install-ask' }
  | { kind: 'installing'; startedAt: number }
  | { kind: 'install-fail'; message: string }
  | { kind: 'serving' }
  | { kind: 'serve-fail' }
  | { kind: 'pick'; choices: ModelChoice[]; initialIndex: number }
  | { kind: 'pulling'; name: string; status: string; completed: number; total: number }
  | { kind: 'pull-fail'; name: string; message: string; choices: ModelChoice[] }
  | { kind: 'done'; model: string }

type Props = {
  spec: SpecSnapshot
  onDone: (model: string) => void
  onManual: () => void
  onBack: () => void
}

export const OllamaBootstrap: React.FC<Props> = ({ spec, onDone, onManual, onBack }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'detecting' })
  const pullAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const daemonAlreadyUp = spec.ollamaDaemonUp || (await isDaemonUp())
      const binaryPresent = spec.hasOllama
      if (cancelled) return
      if (!binaryPresent) {
        setPhase({ kind: 'install-ask' })
        return
      }
      if (!daemonAlreadyUp) {
        await serve()
        return
      }
      await showPicker()
    }
    void run()
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    pullAbortRef.current?.abort()
  }, [])

  const serve = async (): Promise<void> => {
    setPhase({ kind: 'serving' })
    const up = await startDaemon()
    if (!up) {
      setPhase({ kind: 'serve-fail' })
      return
    }
    await showPicker()
  }

  const showPicker = async (): Promise<void> => {
    const installed = await listInstalled()
    const installedNames = new Set(installed.map(m => m.name))
    const recommended = recommendModel(spec)
    const choices: ModelChoice[] = qwenLadder.map(v => ({
      name: v.model,
      installed: installedNames.has(v.model),
      approxGB: v.approxDownloadGB,
      recommended: v.model === recommended.model,
    }))
    for (const m of installed) {
      if (!choices.some(c => c.name === m.name)) {
        choices.push({ name: m.name, installed: true })
      }
    }
    const initialIndex = Math.max(0, choices.findIndex(c => c.recommended))
    setPhase({ kind: 'pick', choices, initialIndex })
  }

  const doInstall = async (): Promise<void> => {
    setPhase({ kind: 'installing', startedAt: Date.now() })
    const result = await installOllama()
    if (!result.ok) {
      setPhase({ kind: 'install-fail', message: result.message })
      return
    }
    setPhase({ kind: 'serving' })
    const up = (await isDaemonUp()) || (await startDaemon())
    if (!up) {
      setPhase({ kind: 'serve-fail' })
      return
    }
    await showPicker()
  }

  const doPull = async (name: string, choices: ModelChoice[]): Promise<void> => {
    const controller = new AbortController()
    pullAbortRef.current = controller
    setPhase({ kind: 'pulling', name, status: 'starting', completed: 0, total: 0 })
    try {
      let lastRender = 0
      for await (const event of pullModel(name, undefined, controller.signal)) {
        if (controller.signal.aborted) return
        const now = Date.now()
        const total = event.total ?? 0
        const completed = event.completed ?? 0
        const isFinal = event.status === 'success' || !total
        if (isFinal || now - lastRender > 100) {
          lastRender = now
          setPhase({ kind: 'pulling', name, status: event.status, completed, total })
        }
      }
      setPhase({ kind: 'done', model: name })
      onDone(name)
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      setPhase({ kind: 'pull-fail', name, message: (err as Error).message, choices })
    } finally {
      pullAbortRef.current = null
    }
  }

  if (phase.kind === 'detecting') {
    if (spec.hasOllama && spec.ollamaDaemonUp) {
      return <Spinner label="ollama running" hint="loading models" />
    }
    if (spec.hasOllama) {
      return <Spinner label="ollama installed" hint="starting daemon" />
    }
    return <Spinner label="checking ollama" />
  }

  if (phase.kind === 'install-ask') {
    return (
      <Box flexDirection="column">
        <Text color={theme.accentSecondary} bold>Install Ollama</Text>
        <Text color={theme.dim}>Ollama isn&apos;t installed yet. I can install it for you.</Text>
        <Text color={theme.dim}>Takes 1–3 minutes depending on your connection.</Text>
        {process.platform === 'win32'
          ? <Text color={theme.dim}>A system prompt will appear — approve it to continue.</Text>
          : null}
        <Box marginTop={1}>
          <Select<'install' | 'manual' | 'back'>
            options={[
              { value: 'install', label: 'install ollama now' },
              { value: 'manual',  label: "i'll set it up myself" },
              { value: 'back',    label: 'go back' },
            ]}
            onSubmit={choice => {
              if (choice === 'install') void doInstall()
              else if (choice === 'manual') onManual()
              else onBack()
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    )
  }

  if (phase.kind === 'installing') {
    return <InstallingView startedAt={phase.startedAt} />
  }

  if (phase.kind === 'install-fail') {
    return (
      <Box flexDirection="column">
        <Text color="#e87070">Install failed: {phase.message}</Text>
        <Box marginTop={1}>
          <Select<'retry' | 'manual' | 'back'>
            options={[
              { value: 'retry',  label: 'retry install' },
              { value: 'manual', label: "i'll set it up myself" },
              { value: 'back',   label: 'go back' },
            ]}
            onSubmit={choice => {
              if (choice === 'retry') void doInstall()
              else if (choice === 'manual') onManual()
              else onBack()
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    )
  }

  if (phase.kind === 'serving') {
    return <Spinner label="starting ollama daemon" />
  }

  if (phase.kind === 'serve-fail') {
    return (
      <Box flexDirection="column">
        <Text color="#e87070">Could not reach Ollama on localhost:11434.</Text>
        <Box marginTop={1}>
          <Select<'retry' | 'manual' | 'back'>
            options={[
              { value: 'retry',  label: 'retry' },
              { value: 'manual', label: "i'll set it up myself" },
              { value: 'back',   label: 'go back' },
            ]}
            onSubmit={choice => {
              if (choice === 'retry') void serve()
              else if (choice === 'manual') onManual()
              else onBack()
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    )
  }

  if (phase.kind === 'pick') {
    const options = phase.choices.map(c => {
      const size = c.approxGB != null ? `~${c.approxGB}GB` : 'size unknown'
      const hint = c.installed
        ? (c.recommended ? 'installed · recommended' : 'installed')
        : (c.recommended ? `${size} · recommended` : size)
      return { value: c.name, label: c.name, hint }
    })
    return (
      <Box flexDirection="column">
        <Text color={theme.accentSecondary} bold>Pick a model</Text>
        <Text color={theme.dim}>Selecting an uninstalled model will pull it now.</Text>
        <Box marginTop={1}>
          <Select
            options={options}
            initialIndex={phase.initialIndex}
            onSubmit={name => {
              const choice = phase.choices.find(c => c.name === name)
              if (!choice) return
              if (choice.installed) {
                setPhase({ kind: 'done', model: name })
                onDone(name)
              } else {
                void doPull(name, phase.choices)
              }
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    )
  }

  if (phase.kind === 'pulling') {
    const progress = phase.total > 0 ? phase.completed / phase.total : 0
    const suffix = phase.total > 0 ? humanize(phase.completed) + ' / ' + humanize(phase.total) : undefined
    return (
      <Box flexDirection="column">
        <Text color={theme.accentSecondary} bold>Pulling {phase.name}</Text>
        <Text color={theme.dim}>{phase.status}</Text>
        <ProgressBar progress={progress} suffix={suffix} />
        <Text color={theme.dim}>Ctrl+c to cancel</Text>
      </Box>
    )
  }

  if (phase.kind === 'pull-fail') {
    return (
      <Box flexDirection="column">
        <Text color="#e87070">Pull failed: {phase.message}</Text>
        <Box marginTop={1}>
          <Select<'retry' | 'pick' | 'back'>
            options={[
              { value: 'retry', label: `retry pulling ${phase.name}` },
              { value: 'pick',  label: 'pick a different model' },
              { value: 'back',  label: 'go back' },
            ]}
            onSubmit={choice => {
              if (choice === 'retry') void doPull(phase.name, phase.choices)
              else if (choice === 'pick') setPhase({ kind: 'pick', choices: phase.choices, initialIndex: 0 })
              else onBack()
            }}
            onCancel={onBack}
          />
        </Box>
      </Box>
    )
  }

  if (phase.kind === 'done') {
    return <Text color={theme.accentSecondary}>ready · {phase.model}</Text>
  }

  return null
}

function humanize(bytes: number): string {
  if (bytes <= 0) return '0MB'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)}GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)}MB`
}

const InstallingView: React.FC<{ startedAt: number }> = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const mm = Math.floor(elapsed / 60).toString().padStart(1, '0')
  const ss = (elapsed % 60).toString().padStart(2, '0')
  const hint = process.platform === 'win32'
    ? 'approve the system prompt if it appears'
    : 'this usually takes 1–3 minutes'
  return (
    <Box flexDirection="column">
      <Text color={theme.accentSecondary} bold>Installing Ollama</Text>
      <Spinner label={`elapsed ${mm}:${ss}`} hint={hint} />
    </Box>
  )
}

export default OllamaBootstrap
