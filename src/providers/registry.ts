import type { EthagentConfig } from '../storage/config.js'
import { localProviderBaseUrlFor } from '../storage/config.js'
import { getKey } from '../storage/secrets.js'
import type { Provider } from './contracts.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import { OpenAIChatProvider } from './openai-chat.js'
import { OpenAIResponsesProvider } from './openai-responses.js'
import { anthropicTools, geminiTools, openAITools } from '../tools/registry.js'
import { openAIBaseUrlFor, OPENAI_OAUTH_DEFAULT_MODEL, isOpenAIOAuthAllowedModel } from '../models/catalog.js'
import {
  getOpenAIOAuthCredentials,
  setOpenAIOAuthCredentials,
  type OpenAIOAuthCredentials,
} from '../auth/openaiOAuth/credentials.js'
import { refreshOpenAIAccessToken, shouldRefresh } from '../auth/openaiOAuth/refresh.js'
import type { Tool } from '../tools/contracts.js'

export const OPENAI_CHATGPT_BACKEND_URL = 'https://chatgpt.com/backend-api/codex'

export function isLocalProvider(provider: string): boolean {
  return provider === 'llamacpp'
}

export function createProvider(config: EthagentConfig, options: { mode?: SessionMode; dynamicTools?: Tool[] } = {}): Provider {
  const mode = options.mode ?? 'chat'
  const toolContext = { hasIdentity: Boolean(config.identity), dynamicTools: options.dynamicTools }
  switch (config.provider) {
    case 'llamacpp':
      return new OpenAIChatProvider({
        id: 'llamacpp',
        model: config.model,
        baseUrl: localProviderBaseUrlFor('llamacpp', config.baseUrl),
        apiKey: 'llamacpp',
        tools: openAITools(mode, toolContext),
      })
    case 'openai':
      return createOpenAIProvider(config, openAITools(mode, toolContext))
    case 'anthropic':
      return new AnthropicProvider({ model: config.model, tools: anthropicTools(mode, toolContext) })
    case 'gemini':
      return new GeminiProvider({ model: config.model, tools: geminiTools(mode, toolContext) })
  }
}

function createOpenAIProvider(config: EthagentConfig, tools: ReturnType<typeof openAITools>): Provider {
  return new OpenAIRoutingProvider(config, tools)
}

class OpenAIRoutingProvider implements Provider {
  readonly id = 'openai' as const
  readonly model: string
  readonly supportsTools: boolean
  private delegate: Provider | null = null
  private readonly config: EthagentConfig
  private readonly tools: ReturnType<typeof openAITools>

  constructor(config: EthagentConfig, tools: ReturnType<typeof openAITools>) {
    this.config = config
    this.tools = tools
    this.model = config.model
    this.supportsTools = tools.length > 0
  }

  async *complete(...args: Parameters<Provider['complete']>): ReturnType<Provider['complete']> {
    if (!this.delegate) this.delegate = await this.resolveDelegate()
    yield* this.delegate.complete(...args)
  }

  private async resolveDelegate(): Promise<Provider> {
    const oauth = await loadFreshOAuthCredentials()
    if (oauth) {
      const oauthModel = isOpenAIOAuthAllowedModel(this.model) ? this.model : OPENAI_OAUTH_DEFAULT_MODEL
      return new OpenAIResponsesProvider({
        model: oauthModel,
        baseUrl: OPENAI_CHATGPT_BACKEND_URL,
        accessToken: oauth.accessToken,
        accountId: oauth.accountId,
        tools: this.tools,
        refresh: async () => {
          const next = await loadFreshOAuthCredentials({ force: true })
          if (!next) throw new Error('No OAuth credentials available')
          return next.accessToken
        },
      })
    }
    return new OpenAIChatProvider({
      id: 'openai',
      model: this.model,
      baseUrl: openAIBaseUrlFor(this.config),
      loadApiKey: () => getKey('openai'),
      tools: this.tools,
    })
  }
}

async function loadFreshOAuthCredentials(options: { force?: boolean } = {}): Promise<OpenAIOAuthCredentials | null> {
  const current = await getOpenAIOAuthCredentials()
  if (!current) return null
  if (!options.force && !shouldRefresh(current)) return current

  try {
    const refreshed = await refreshOpenAIAccessToken(current.refreshToken)
    const now = Date.now()
    const next: OpenAIOAuthCredentials = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      idToken: refreshed.idToken ?? current.idToken,
      accountId: refreshed.accountId ?? current.accountId,
      expiresAt: now + refreshed.expiresIn * 1000,
      lastRefreshAt: now,
    }
    await setOpenAIOAuthCredentials(next)
    return next
  } catch {
    return current
  }
}
