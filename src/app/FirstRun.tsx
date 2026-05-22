import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { BrandSplash as Splash } from '../ui/BrandSplash.js'
import { Select } from '../ui/Select.js'
import { Spinner } from '../ui/Spinner.js'
import { Surface } from '../ui/Surface.js'
import { TextInput } from '../ui/TextInput.js'
import { theme } from '../ui/theme.js'
import { ModelPicker, type ModelPickerSelection } from '../models/ModelPicker.js'
import { formatModelDisplayName } from '../models/modelDisplay.js'
import { providerDisplayName } from '../models/providerDisplay.js'
import { detectSpec, type SpecSnapshot } from '../models/runtimeDetection.js'
import { FEATURED_HF_REPO_URL } from '../models/modelRecommendation.js'
import { OPENAI_OAUTH_DEFAULT_MODEL } from '../models/catalog.js'
import { OpenAIOAuthService } from '../auth/openaiOAuth/index.js'
import { openExternalUrl } from '../utils/openExternal.js'
import {
  loadConfig,
  saveConfigWithMerge,
  normalizeConfig,
  defaultModelFor,
  defaultBaseUrlFor,
  type EthagentConfig,
  type ProviderId,
} from '../storage/config.js'
import { setKey } from '../storage/secrets.js'
import { IdentityHub, type IdentityHubResult } from '../identity/hub/IdentityHub.js'
import { FirstRunTimeline, firstRunStageNumber, type FirstRunStepKind } from './FirstRunTimeline.js'
import { configFromModelPickerSelection, formatGB } from './firstRunConfig.js'

type Step =
  | { kind: 'detecting' }
  | { kind: 'detect-error'; message: string }
  | { kind: 'identity-start'; spec: SpecSnapshot }
  | { kind: 'identity-start-saving'; spec: SpecSnapshot; result: IdentityHubResult }
  | { kind: 'choose-path'; spec: SpecSnapshot }
  | { kind: 'hf-setup'; spec: SpecSnapshot }
  | { kind: 'cloud-provider' }
  | { kind: 'cloud-openai-auth' }
  | { kind: 'cloud-openai-oauth'; phase: 'waiting' | 'exchanging' | 'error'; url?: string; message?: string }
  | { kind: 'cloud-key'; provider: ProviderId; error?: string }
  | { kind: 'cloud-key-saving'; provider: ProviderId }
  | { kind: 'cloud-model'; provider: ProviderId }
  | { kind: 'saving'; config: EthagentConfig }
  | { kind: 'save-error'; config: EthagentConfig; message: string }
  | { kind: 'done'; config: EthagentConfig }

type FirstRunProps = {
  onComplete: (config: EthagentConfig) => void
  onCancel: () => void
}

const TITLE: Record<string, string> = {
  'detecting':              'Inspecting Machine',
  'detect-error':           'Detection Failed',
  'choose-path':            'Choose How To Run',
  'hf-setup':               'Local Model',
  'cloud-provider':         'Pick A Cloud Provider',
  'cloud-openai-auth':      'Sign in with ChatGPT or API Key',
  'cloud-openai-oauth':     'Sign in with ChatGPT',
  'cloud-key':              'Paste API Key',
  'cloud-key-saving':       'Storing Key',
  'cloud-model':            'Pick A Model',
  'saving':                 'Saving Config',
  'save-error':             'Save Failed',
  'done':                   'Ready',
}

const NAV_BACK = '↑↓ navigate · enter select · esc back'
const NAV_CANCEL = '↑↓ navigate · enter select · esc cancel setup'

export const FirstRun: React.FC<FirstRunProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<Step>({ kind: 'detecting' })
  const [history, setHistory] = useState<Step[]>([])
  const [firstRunIdentity, setFirstRunIdentity] = useState<EthagentConfig['identity']>(undefined)
  const [firstRunConfig, setFirstRunConfig] = useState<EthagentConfig | undefined>(undefined)
  const oauthServiceRef = useRef<OpenAIOAuthService | null>(null)

  useEffect(() => {
    let cancelled = false
    loadConfig()
      .then(loaded => {
        if (cancelled || !loaded) return
        setFirstRunConfig(loaded)
        if (loaded.identity) setFirstRunIdentity(loaded.identity)
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [])

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
        setStep({ kind: 'identity-start', spec })
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
    const incoming = normalizeConfig(step.config)
    ;(async () => {
      try {
        const merged = await saveConfigWithMerge(current => {
          if (!current) return incoming
          const baseErc = current.erc8004
          const incErc = incoming.erc8004
          const next: EthagentConfig = { ...current, ...incoming }
          if (baseErc || incErc) {
            const mergedVaults = {
              ...(baseErc?.operatorVaults ?? {}),
              ...(incErc?.operatorVaults ?? {}),
            }
            const erc = {
              ...(baseErc ?? {}),
              ...(incErc ?? {}),
              ...(Object.keys(mergedVaults).length > 0 ? { operatorVaults: mergedVaults } : {}),
            } as NonNullable<EthagentConfig['erc8004']>
            next.erc8004 = erc
          }
          return next
        })
        if (cancelled) return
        setStep({ kind: 'done', config: merged })
        onComplete(merged)
      } catch (err: unknown) {
        if (cancelled) return
        setStep({ kind: 'save-error', config: incoming, message: (err as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [step, onComplete])

  useEffect(() => {
    if (step.kind !== 'identity-start-saving') return
    let cancelled = false
    const persist = async (): Promise<void> => {
      if (step.result.kind === 'token') {
        setFirstRunIdentity(step.result.identity)
      }
      const reloaded = await loadConfig().catch(() => null)
      if (cancelled || !reloaded) return
      setFirstRunConfig(reloaded)
    }
    persist()
      .then(() => {
        if (cancelled) return
        setStep({ kind: 'choose-path', spec: step.spec })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStep({
          kind: 'detect-error',
          message: `Could not store identity: ${(err as Error).message}`,
        })
      })
    return () => { cancelled = true }
  }, [step])

  const navHint = (canBack: boolean): string => canBack ? NAV_BACK : NAV_CANCEL

  const startFirstRunOpenAIOAuth = async (): Promise<void> => {
    oauthServiceRef.current?.cleanup()
    const service = new OpenAIOAuthService()
    oauthServiceRef.current = service
    goTo({ kind: 'cloud-openai-oauth', phase: 'waiting' })
    try {
      const result = await service.start(authUrl => {
        openExternalUrl(authUrl)
        setStep({ kind: 'cloud-openai-oauth', phase: 'waiting', url: authUrl })
      })
      if (oauthServiceRef.current !== service) return
      setStep({ kind: 'cloud-openai-oauth', phase: 'exchanging' })
      if (result.kind === 'apikey') {
        if (typeof result.apiKey !== 'string' || result.apiKey.length === 0) {
          throw new Error('OAuth result was apikey kind but no key was returned')
        }
        await setKey('openai', result.apiKey)
      }
      if (oauthServiceRef.current !== service) return
      oauthServiceRef.current = null
      if (result.kind === 'oauth-only') {
        setStep({
          kind: 'saving',
          config: withFirstRunIdentity({
            version: 1,
            provider: 'openai',
            model: OPENAI_OAUTH_DEFAULT_MODEL,
            firstRunAt: new Date().toISOString(),
          }),
        })
        return
      }
      setStep({ kind: 'cloud-model', provider: 'openai' })
    } catch (err: unknown) {
      if (oauthServiceRef.current !== service) return
      oauthServiceRef.current = null
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'OpenAI sign-in was cancelled.') {
        setStep({ kind: 'cloud-openai-auth' })
        return
      }
      setStep({ kind: 'cloud-openai-oauth', phase: 'error', message })
    }
  }

  const withFirstRunIdentity = (config: EthagentConfig): EthagentConfig => {
    const merged: EthagentConfig = firstRunConfig
      ? {
          ...firstRunConfig,
          ...config,
          ...(firstRunConfig.erc8004 ? { erc8004: { ...firstRunConfig.erc8004, ...(config.erc8004 ?? {}) } } : config.erc8004 ? { erc8004: config.erc8004 } : {}),
        }
      : config
    return firstRunIdentity ? { ...merged, identity: firstRunIdentity } : merged
  }

  const renderShell = (
    currentKind: FirstRunStepKind,
    title: string,
    body: React.ReactNode,
    footer?: string,
  ): React.ReactElement => (
    <Box flexDirection="column" padding={1}>
      <Splash />
      <Box marginTop={1}>
        <Surface
          title={title}
          subtitle={<FirstRunTimeline current={firstRunStageNumber(currentKind)} />}
          footer={footer}
        >
          {body}
        </Surface>
      </Box>
    </Box>
  )

  const renderRaw = (
    currentKind: FirstRunStepKind,
    body: React.ReactNode,
    bodyOwnsTimeline = false,
  ): React.ReactElement => (
    <Box flexDirection="column" padding={1}>
      <Splash />
      {bodyOwnsTimeline ? null : (
        <Box marginTop={1} marginBottom={1}>
          <FirstRunTimeline current={firstRunStageNumber(currentKind)} />
        </Box>
      )}
      {body}
    </Box>
  )

  if (step.kind === 'detecting') {
    return renderShell(step.kind, TITLE['detecting']!, (
      <Text color={theme.dim}>Inspecting machine…</Text>
    ))
  }

  if (step.kind === 'detect-error') {
    return renderShell(step.kind, TITLE['detect-error']!, (
      <>
        <Text color={theme.accentError}>Could not inspect machine: {step.message}</Text>
        <Box marginTop={1}>
          <Select<'quit'>
            options={[{ value: 'quit', label: 'quit' }]}
            onSubmit={onCancel}
            onCancel={onCancel}
          />
        </Box>
      </>
    ))
  }

  if (step.kind === 'identity-start') {
    return renderRaw(step.kind, (
      <IdentityHub
        mode="first-run"
        config={firstRunConfig}
        onConfigChange={setFirstRunConfig}
        onComplete={result => {
          if (result.kind === 'cancel') {
            onCancel()
            return
          }
          if (result.kind === 'skip') {
            setStep({ kind: 'choose-path', spec: step.spec })
            return
          }
          setStep({ kind: 'identity-start-saving', spec: step.spec, result })
        }}
      />
    ), true)
  }

  if (step.kind === 'identity-start-saving') {
    return renderShell(step.kind, 'Storing Identity', (
      <Text color={theme.dim}>Storing identity...</Text>
    ))
  }

  if (step.kind === 'choose-path') {
    const { spec } = step
    return renderShell(step.kind, TITLE['choose-path']!, (
      <>
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>
            detected {formatGB(spec.effectiveRamBytes)} RAM
            {spec.gpuVramBytes ? `, ${formatGB(spec.gpuVramBytes)} VRAM` : ''}
            {spec.isAppleSilicon ? ', Apple Silicon' : ''}
          </Text>
        </Box>
        <Select<'hf' | 'cloud'>
          options={[
            { value: 'hf', label: 'Local Model', hint: 'Download and run locally' },
            { value: 'cloud', label: 'Cloud API', hint: 'OpenAI, Anthropic, or Gemini' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'cloud') goTo({ kind: 'cloud-provider' })
            else goTo({ kind: 'hf-setup', spec })
          }}
          onCancel={onCancel}
        />
      </>
    ), navHint(false))
  }

  if (step.kind === 'hf-setup') {
    const modelPickerConfig: EthagentConfig = withFirstRunIdentity({
      version: 1,
      provider: 'llamacpp',
      model: defaultModelFor('llamacpp'),
      baseUrl: defaultBaseUrlFor('llamacpp'),
      firstRunAt: new Date().toISOString(),
    })
    return renderRaw(step.kind, (
      <ModelPicker
        currentConfig={modelPickerConfig}
        currentProvider="llamacpp"
        currentModel={modelPickerConfig.model}
        featuredHfRepo={FEATURED_HF_REPO_URL}
        localOnly
        onPick={(selection: ModelPickerSelection) => {
          goTo({ kind: 'saving', config: configFromModelPickerSelection(selection, modelPickerConfig) })
        }}
        onCancel={goBack}
      />
    ))
  }

  if (step.kind === 'cloud-provider') {
    return renderShell(step.kind, TITLE['cloud-provider']!, (
      <Select<ProviderId>
        options={[
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ]}
        onSubmit={provider => {
          if (provider === 'openai') goTo({ kind: 'cloud-openai-auth' })
          else goTo({ kind: 'cloud-key', provider })
        }}
        onCancel={goBack}
      />
    ), navHint(true))
  }

  if (step.kind === 'cloud-openai-auth') {
    return renderShell(step.kind, TITLE['cloud-openai-auth']!, (
      <Select<'oauth' | 'apikey'>
        options={[
          { value: 'oauth', role: 'section', label: 'Recommended' },
          { value: 'oauth', label: 'Sign in with ChatGPT', hint: 'Use your ChatGPT subscription', bold: true },
          { value: 'apikey', role: 'section', label: 'Alternative' },
          { value: 'apikey', label: 'Paste API Key', hint: 'Use an OpenAI platform key', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => {
          if (choice === 'oauth') void startFirstRunOpenAIOAuth()
          else goTo({ kind: 'cloud-key', provider: 'openai' })
        }}
        onCancel={goBack}
      />
    ), navHint(true))
  }

  if (step.kind === 'cloud-openai-oauth') {
    if (step.phase === 'error') {
      return renderShell(step.kind, TITLE['cloud-openai-oauth']!, (
        <>
          <Text color={theme.accentError}>{step.message ?? 'Sign-in did not complete.'}</Text>
          <Box marginTop={1}>
            <Select<'retry' | 'apikey' | 'back'>
              options={[
                { value: 'retry', role: 'section', label: 'Recovery' },
                { value: 'retry', label: 'Try Again', hint: 'Reopen the browser sign-in flow' },
                { value: 'apikey', label: 'Use API Key Instead', hint: 'Paste an OpenAI platform key' },
                { value: 'back', role: 'section', label: 'Navigation' },
                { value: 'back', label: 'Back', hint: 'Return to sign-in choice', role: 'utility' },
              ]}
              hintLayout="inline"
              onSubmit={choice => {
                if (choice === 'retry') void startFirstRunOpenAIOAuth()
                else if (choice === 'apikey') goTo({ kind: 'cloud-key', provider: 'openai' })
                else goTo({ kind: 'cloud-openai-auth' })
              }}
              onCancel={() => goTo({ kind: 'cloud-openai-auth' })}
            />
          </Box>
        </>
      ), navHint(true))
    }
    if (step.phase === 'exchanging') {
      return renderShell(step.kind, TITLE['cloud-openai-oauth']!, (
        <Box marginTop={1}>
          <Spinner label="completing sign-in..." />
        </Box>
      ))
    }
    return renderShell(step.kind, TITLE['cloud-openai-oauth']!, (
      <>
        <Spinner label="waiting for browser sign-in..." />
        {step.url ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.dim}>If the browser did not open, visit:</Text>
            <Text color={theme.dim}>{step.url}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Select<'cancel'>
            options={[{ value: 'cancel', label: 'Cancel Sign-in', role: 'utility' }]}
            hintLayout="inline"
            onSubmit={() => {
              oauthServiceRef.current?.cleanup()
              oauthServiceRef.current = null
              goTo({ kind: 'cloud-openai-auth' })
            }}
            onCancel={() => {
              oauthServiceRef.current?.cleanup()
              oauthServiceRef.current = null
              goTo({ kind: 'cloud-openai-auth' })
            }}
          />
        </Box>
      </>
    ))
  }

  if (step.kind === 'cloud-key' || step.kind === 'cloud-key-saving') {
    const provider = step.provider
    const saving = step.kind === 'cloud-key-saving'
    const error = step.kind === 'cloud-key' ? step.error : undefined
    const keyTitle = `${TITLE[saving ? 'cloud-key-saving' : 'cloud-key']!} · ${providerDisplayName(provider)}`
    return renderShell(step.kind, keyTitle, (
      <>
        <Text color={theme.dim}>stored in your OS keyring when available; never written to config.json</Text>
        {error ? <Text color={theme.accentError}>{error}</Text> : null}
        <Box marginTop={1}>
          <TextInput
            isSecret
            placeholder={provider === 'openai' ? 'sk-...' : 'paste key and press enter'}
            chromeWidth={4}
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
        {saving ? <Text color={theme.dim}>storing key…</Text> : null}
      </>
    ), saving ? undefined : navHint(true))
  }

  if (step.kind === 'cloud-model') {
    const { provider } = step
    const defaultModel = defaultModelFor(provider)
    return renderShell(step.kind, TITLE['cloud-model']!, (
      <>
        <Text color={theme.dim}>press enter to accept default: {defaultModel}</Text>
        <Box marginTop={1}>
          <TextInput
            initialValue={defaultModel}
            placeholder={defaultModel}
            chromeWidth={4}
            onSubmit={model => goTo({
              kind: 'saving',
              config: withFirstRunIdentity({
                version: 1,
                provider,
                model: model.trim() || defaultModel,
                firstRunAt: new Date().toISOString(),
              }),
            })}
            onCancel={goBack}
          />
        </Box>
      </>
    ), navHint(true))
  }

  if (step.kind === 'saving') {
    return renderShell(step.kind, TITLE['saving']!, (
      <Text color={theme.dim}>saving config…</Text>
    ))
  }

  if (step.kind === 'save-error') {
    return renderShell(step.kind, TITLE['save-error']!, (
      <>
        <Text color={theme.accentError}>{step.message}</Text>
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
      </>
    ), navHint(history.length > 0))
  }

  if (step.kind === 'done') {
    return renderShell(step.kind, TITLE['done']!, (
      <Text color={theme.accentPeriwinkle}>
        Ready · {providerDisplayName(step.config.provider)} · {formatModelDisplayName(step.config.provider, step.config.model, { maxLength: 48 })}
      </Text>
    ))
  }

  return null
}

