import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { BrandSplash as Splash } from '../ui/BrandSplash.js'
import { Select } from '../ui/Select.js'
import { TextInput } from '../ui/TextInput.js'
import { theme } from '../ui/theme.js'
import { detectSpec, type SpecSnapshot } from './runtimeDetection.js'
import { recommendModel } from './modelRecommendation.js'
import { OllamaBootstrap } from './OllamaBootstrap.js'
import {
  saveConfig,
  defaultModelFor,
  defaultBaseUrlFor,
  type EthagentConfig,
  type ProviderId,
} from '../storage/config.js'
import { setKey, setSecret } from '../storage/secrets.js'
import { IdentitySetup, type IdentityResult } from '../identity/IdentitySetup.js'

type Step =
  | { kind: 'detecting' }
  | { kind: 'detect-error'; message: string }
  | { kind: 'choose-path'; spec: SpecSnapshot }
  | { kind: 'ollama-setup'; spec: SpecSnapshot }
  | { kind: 'ollama-manual'; spec: SpecSnapshot }
  | { kind: 'cloud-provider' }
  | { kind: 'cloud-key'; provider: ProviderId; error?: string }
  | { kind: 'cloud-key-saving'; provider: ProviderId }
  | { kind: 'cloud-model'; provider: ProviderId }
  | { kind: 'identity'; config: EthagentConfig }
  | { kind: 'identity-saving'; config: EthagentConfig; result: IdentityResult }
  | { kind: 'saving'; config: EthagentConfig }
  | { kind: 'save-error'; config: EthagentConfig; message: string }
  | { kind: 'done'; config: EthagentConfig }

type FirstRunProps = {
  onComplete: (config: EthagentConfig) => void
  onCancel: () => void
}

const STATUS: Record<Step['kind'], string> = {
  'detecting':         'first-run setup · inspecting machine',
  'detect-error':      'first-run setup · detection failed',
  'choose-path':       'first-run setup · choose how to run',
  'ollama-setup':      'first-run setup · ollama',
  'ollama-manual':     'first-run setup · ollama manual',
  'cloud-provider':    'first-run setup · pick a cloud provider',
  'cloud-key':         'first-run setup · paste API key',
  'cloud-key-saving':  'first-run setup · storing key',
  'cloud-model':       'first-run setup · pick a model',
  'identity':          'first-run setup · Ethereum identity',
  'identity-saving':   'first-run setup · storing identity',
  'saving':            'first-run setup · saving config',
  'save-error':        'first-run setup · save failed',
  'done':              'ready',
}

const IDENTITY_ACCOUNT = 'ethereum:default'

const NAV_BACK = '↑↓ navigate · enter select · esc back'
const NAV_CANCEL = '↑↓ navigate · enter select · esc cancel setup'

export const FirstRun: React.FC<FirstRunProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<Step>({ kind: 'detecting' })
  const [history, setHistory] = useState<Step[]>([])

  const goTo = (next: Step): void => {
    setHistory(h => [...h, step])
    setStep(next)
  }

  const goBack = (): void => {
    if (history.length === 0) {
      onCancel()
      return
    }
    const prev = history[history.length - 1]!
    setStep(prev)
    setHistory(h => h.slice(0, -1))
  }

  useEffect(() => {
    let cancelled = false
    detectSpec()
      .then(spec => {
        if (cancelled) return
        setStep({ kind: 'choose-path', spec })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStep({ kind: 'detect-error', message: (err as Error).message })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (step.kind !== 'saving') return
    let cancelled = false
    saveConfig(step.config)
      .then(() => {
        if (cancelled) return
        setStep({ kind: 'done', config: step.config })
        onComplete(step.config)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStep({ kind: 'save-error', config: step.config, message: (err as Error).message })
      })
    return () => { cancelled = true }
  }, [step, onComplete])

  useEffect(() => {
    if (step.kind !== 'identity-saving') return
    let cancelled = false
    const persist = async (): Promise<EthagentConfig> => {
      if (step.result.kind === 'set') {
        await setSecret(IDENTITY_ACCOUNT, step.result.privateKey)
        return {
          ...step.config,
          identity: {
            address: step.result.address,
            createdAt: new Date().toISOString(),
          },
        }
      }
      return step.config
    }
    persist()
      .then(config => {
        if (cancelled) return
        setStep({ kind: 'saving', config })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStep({ kind: 'save-error', config: step.config, message: (err as Error).message })
      })
    return () => { cancelled = true }
  }, [step])

  const hint = (canBack: boolean): React.ReactElement => (
    <Box marginTop={1}>
      <Text color={theme.dim}>{canBack ? NAV_BACK : NAV_CANCEL}</Text>
    </Box>
  )

  if (step.kind === 'detecting') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['detecting']} />
        <Text color={theme.dim}>inspecting machine…</Text>
      </Box>
    )
  }

  if (step.kind === 'detect-error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['detect-error']} />
        <Text color="#e87070">could not inspect machine: {step.message}</Text>
        <Box marginTop={1}>
          <Select<'quit'>
            options={[{ value: 'quit', label: 'quit' }]}
            onSubmit={onCancel}
            onCancel={onCancel}
          />
        </Box>
      </Box>
    )
  }

  if (step.kind === 'choose-path') {
    const { spec } = step
    const recommended = recommendModel(spec)
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['choose-path']} />
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>
            detected {formatGB(spec.effectiveRamBytes)} RAM
            {spec.gpuVramBytes ? `, ${formatGB(spec.gpuVramBytes)} VRAM` : ''}
            {spec.isAppleSilicon ? ', Apple Silicon' : ''}
          </Text>
          <Text color={theme.dim}>
            ollama: {spec.ollamaDaemonUp
              ? `running (${spec.installedModels.length} models)`
              : spec.hasOllama ? 'installed but not running' : 'not installed'}
          </Text>
          <Text color={theme.dim}>recommended: {recommended.model}</Text>
        </Box>
        <Select<'cloud' | 'ollama'>
          label="how do you want to run?"
          options={[
            { value: 'cloud',  label: 'cloud API', hint: 'anthropic, openai, or gemini' },
            { value: 'ollama', label: 'local ollama', hint: 'offline, runs on your machine' },
          ]}
          onSubmit={choice => {
            if (choice === 'cloud') goTo({ kind: 'cloud-provider' })
            else goTo({ kind: 'ollama-setup', spec })
          }}
          onCancel={onCancel}
        />
        {hint(false)}
      </Box>
    )
  }

  if (step.kind === 'ollama-setup') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['ollama-setup']} />
        <OllamaBootstrap
          spec={step.spec}
          onDone={model => goTo({
            kind: 'identity',
            config: {
              version: 1,
              provider: 'ollama',
              model,
              baseUrl: defaultBaseUrlFor('ollama'),
              firstRunAt: new Date().toISOString(),
            },
          })}
          onManual={() => setStep({ kind: 'ollama-manual', spec: step.spec })}
          onBack={goBack}
        />
      </Box>
    )
  }

  if (step.kind === 'ollama-manual') {
    const recModel = recommendModel(step.spec).model
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['ollama-manual']} />
        <Text color={theme.accentPrimary}>set ollama up yourself:</Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <Text color={theme.dim}>  1. install from https://ollama.com/download</Text>
          <Text color={theme.dim}>  2. start the daemon (open the app, or run: ollama serve)</Text>
          <Text color={theme.dim}>  3. pull the recommended model:  ollama pull {recModel}</Text>
          <Text color={theme.dim}>  4. re-run: ethagent</Text>
        </Box>
        <Select<'cloud' | 'back' | 'quit'>
          label="what next?"
          options={[
            { value: 'cloud', label: 'switch to cloud API setup' },
            { value: 'back',  label: 'go back' },
            { value: 'quit',  label: 'quit setup' },
          ]}
          onSubmit={choice => {
            if (choice === 'cloud') goTo({ kind: 'cloud-provider' })
            else if (choice === 'back') goBack()
            else onCancel()
          }}
          onCancel={goBack}
        />
        {hint(true)}
      </Box>
    )
  }

  if (step.kind === 'cloud-provider') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['cloud-provider']} />
        <Text color={theme.accentSecondary} bold>pick a cloud provider</Text>
        <Box marginTop={1}>
          <Select<ProviderId>
            options={[
              { value: 'openai',    label: 'openai' },
              { value: 'anthropic', label: 'anthropic' },
              { value: 'gemini',    label: 'gemini' },
            ]}
            onSubmit={provider => goTo({ kind: 'cloud-key', provider })}
            onCancel={goBack}
          />
        </Box>
        {hint(true)}
      </Box>
    )
  }

  if (step.kind === 'cloud-key' || step.kind === 'cloud-key-saving') {
    const provider = step.provider
    const saving = step.kind === 'cloud-key-saving'
    const error = step.kind === 'cloud-key' ? step.error : undefined
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={saving ? STATUS['cloud-key-saving'] : STATUS['cloud-key']} />
        <Text color={theme.accentSecondary} bold>paste your {provider} API key</Text>
        <Text color={theme.dim}>stored in your OS keyring when available; never written to config.json</Text>
        {error ? <Text color="#e87070">{error}</Text> : null}
        <Box marginTop={1}>
          <TextInput
            isSecret
            placeholder={provider === 'openai' ? 'sk-...' : 'paste key and press enter'}
            validate={v => v.trim().length >= 8 ? null : 'key looks too short'}
            onSubmit={async value => {
              const trimmed = value.trim()
              setHistory(h => [...h, { kind: 'cloud-key', provider }])
              setStep({ kind: 'cloud-key-saving', provider })
              try {
                await setKey(provider, trimmed)
                setStep({ kind: 'cloud-model', provider })
              } catch (err: unknown) {
                setHistory(h => h.slice(0, -1))
                setStep({
                  kind: 'cloud-key',
                  provider,
                  error: `could not store key: ${(err as Error).message}`,
                })
              }
            }}
            onCancel={goBack}
          />
        </Box>
        {saving ? <Text color={theme.dim}>storing key…</Text> : hint(true)}
      </Box>
    )
  }

  if (step.kind === 'cloud-model') {
    const { provider } = step
    const defaultModel = defaultModelFor(provider)
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['cloud-model']} />
        <Text color={theme.accentSecondary} bold>which model?</Text>
        <Text color={theme.dim}>press enter to accept default: {defaultModel}</Text>
        <Box marginTop={1}>
          <TextInput
            initialValue={defaultModel}
            placeholder={defaultModel}
            onSubmit={model => goTo({
              kind: 'identity',
              config: {
                version: 1,
                provider,
                model: model.trim() || defaultModel,
                firstRunAt: new Date().toISOString(),
              },
            })}
            onCancel={goBack}
          />
        </Box>
        {hint(true)}
      </Box>
    )
  }

  if (step.kind === 'identity') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['identity']} />
        <IdentitySetup
          mode="first-run"
          onComplete={result => {
            if (result.kind === 'cancel') {
              goBack()
              return
            }
            setStep({ kind: 'identity-saving', config: step.config, result })
          }}
        />
      </Box>
    )
  }

  if (step.kind === 'identity-saving') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['identity-saving']} />
        <Text color={theme.dim}>storing identity…</Text>
      </Box>
    )
  }

  if (step.kind === 'saving') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['saving']} />
        <Text color={theme.dim}>saving config…</Text>
      </Box>
    )
  }

  if (step.kind === 'save-error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={STATUS['save-error']} />
        <Text color="#e87070">{step.message}</Text>
        <Box marginTop={1}>
          <Select<'retry' | 'back' | 'quit'>
            options={[
              { value: 'retry', label: 'retry save' },
              { value: 'back',  label: 'go back and edit' },
              { value: 'quit',  label: 'quit setup' },
            ]}
            onSubmit={choice => {
              if (choice === 'retry') setStep({ kind: 'saving', config: step.config })
              else if (choice === 'back') goBack()
              else onCancel()
            }}
            onCancel={goBack}
          />
        </Box>
        {hint(history.length > 0)}
      </Box>
    )
  }

  if (step.kind === 'done') {
    return (
      <Box flexDirection="column" padding={1}>
        <Splash tipLine={`ready · ${step.config.provider} · ${step.config.model}`} />
        <Text color={theme.accentSecondary}>all set.</Text>
      </Box>
    )
  }

  return null
}

function formatGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  return gb < 10 ? `${gb.toFixed(1)}GB` : `${Math.round(gb)}GB`
}
