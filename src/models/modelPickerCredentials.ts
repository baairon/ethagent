import type React from 'react'
import { OpenAIOAuthService } from '../auth/openaiOAuth/index.js'
import { hasOpenAIOAuthCredentials, rmOpenAIOAuthCredentials } from '../auth/openaiOAuth/credentials.js'
import { openExternalUrl } from '../utils/openExternal.js'
import { hasKey, rmKey, setKey } from '../storage/secrets.js'
import type { EthagentConfig, ProviderId } from '../storage/config.js'
import {
  clearModelCatalogCache,
  discoverProviderModels,
  isOpenAIOAuthAllowedModel,
  OPENAI_OAUTH_DEFAULT_MODEL,
} from './catalog.js'
import type { CloudCredentialKind, CloudProviderId } from './modelPickerOptions.js'
import type {
  LoadedModelPickerData as LoadedData,
  ModelPickerSelection,
  ModelPickerState as State,
} from './modelPickerTypes.js'
import { configForProvider, pickFallbackSelection } from './modelPickerViewHelpers.js'

export async function submitKey(
  state: Extract<State, { kind: 'keyEntry' }>,
  value: string,
  currentConfig: EthagentConfig,
  setState: (s: State) => void,
): Promise<void> {
  const trimmed = value.trim()
  if (!trimmed) {
    setState({ ...state, error: 'key cannot be empty' })
    return
  }
  setState({ ...state, submitting: true, error: undefined })
  try {
    await setKey(state.provider, trimmed)
    const data = await refreshProviderKeyState(state.data, currentConfig, state.provider)
    setState({ kind: 'list', data })
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
  }
}

export async function startOpenAIOAuthFlow(
  data: LoadedData,
  currentConfig: EthagentConfig,
  setState: (s: State) => void,
  serviceRef: React.MutableRefObject<OpenAIOAuthService | null>,
  onPick: (sel: ModelPickerSelection) => void,
): Promise<void> {
  serviceRef.current?.cleanup()
  const service = new OpenAIOAuthService()
  serviceRef.current = service
  setState({ kind: 'oauthLogin', data, phase: 'waiting' })
  try {
    const result = await service.start(authUrl => {
      openExternalUrl(authUrl)
      setState({ kind: 'oauthLogin', data, phase: 'waiting', url: authUrl })
    })
    if (serviceRef.current !== service) return
    setState({ kind: 'oauthLogin', data, phase: 'exchanging' })
    if (result.kind === 'apikey') {
      if (typeof result.apiKey !== 'string' || result.apiKey.length === 0) {
        throw new Error(`OAuth result was apikey kind but apiKey is ${typeof result.apiKey}; refusing to store.`)
      }
      try {
        await setKey('openai', result.apiKey)
      } catch (err) {
        throw new Error(`Storing the OpenAI API key failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    let refreshed: LoadedData
    try {
      refreshed = await refreshProviderKeyState(data, currentConfig, 'openai')
    } catch (err) {
      throw new Error(`Refreshing the OpenAI provider state failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (serviceRef.current !== service) return
    serviceRef.current = null
    if (result.kind === 'oauth-only' && !isOpenAIOAuthAllowedModel(currentConfig.model)) {
      onPick({ kind: 'cloud', provider: 'openai', model: OPENAI_OAUTH_DEFAULT_MODEL, keyJustSet: true })
      return
    }
    setState({ kind: 'list', data: refreshed })
  } catch (err: unknown) {
    if (serviceRef.current !== service) return
    serviceRef.current = null
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'OpenAI sign-in was cancelled.') {
      setState({ kind: 'list', data })
      return
    }
    setState({ kind: 'oauthLogin', data, phase: 'error', message })
  }
}

export async function deleteKey(
  state: Extract<State, { kind: 'keyManage' }>,
  currentConfig: EthagentConfig,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
  currentProvider: ProviderId,
): Promise<void> {
  setState({ ...state, submitting: true, error: undefined })
  try {
    await rmKey(state.provider)
    if (state.provider === 'openai') await rmOpenAIOAuthCredentials()
    const data = await refreshProviderKeyState(state.data, currentConfig, state.provider)
    if (currentProvider === state.provider) {
      const fallback = pickFallbackSelection(data, state.provider)
      if (fallback) {
        onPick(fallback)
        return
      }
    }
    setState({ kind: 'list', data })
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
  }
}

export async function signOutOAuth(
  state: Extract<State, { kind: 'oauthManage' }>,
  currentConfig: EthagentConfig,
  setState: (s: State) => void,
  onPick: (sel: ModelPickerSelection) => void,
  currentProvider: ProviderId,
): Promise<void> {
  setState({ ...state, submitting: true, error: undefined })
  try {
    await rmKey('openai')
    await rmOpenAIOAuthCredentials()
    const data = await refreshProviderKeyState(state.data, currentConfig, 'openai')
    if (currentProvider === 'openai') {
      const fallback = pickFallbackSelection(data, 'openai')
      if (fallback) {
        onPick(fallback)
        return
      }
    }
    setState({ kind: 'list', data })
  } catch (err: unknown) {
    setState({ ...state, submitting: false, error: (err as Error).message })
  }
}

async function refreshProviderKeyState(
  data: LoadedData,
  currentConfig: EthagentConfig,
  provider: CloudProviderId,
): Promise<LoadedData> {
  clearModelCatalogCache()
  const apiKeySet = await hasKey(provider)
  const oauthSet = provider === 'openai' ? await hasOpenAIOAuthCredentials() : false
  const keySet = apiKeySet || oauthSet
  const cloudKeys = { ...data.cloudKeys, [provider]: keySet }
  const cloudCredentialKinds: Partial<Record<ProviderId, CloudCredentialKind>> = { ...(data.cloudCredentialKinds ?? {}) }
  if (oauthSet) cloudCredentialKinds[provider] = 'oauth'
  else if (apiKeySet) cloudCredentialKinds[provider] = 'apikey'
  else delete cloudCredentialKinds[provider]
  const cloudCatalogs = { ...data.cloudCatalogs }
  if (keySet) {
    cloudCatalogs[provider] = await discoverProviderModels(configForProvider(currentConfig, provider))
  } else {
    delete cloudCatalogs[provider]
  }
  return { ...data, cloudKeys, cloudCatalogs, cloudCredentialKinds }
}
