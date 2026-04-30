import type { EthagentConfig } from '../storage/config.js'
import { localProviderBaseUrlFor } from '../storage/config.js'
import { getKey } from '../storage/secrets.js'
import type { Provider } from './contracts.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import { OpenAIChatProvider } from './openai-chat.js'
import { anthropicTools, openAITools } from '../tools/registry.js'
import { openAIBaseUrlFor } from '../models/catalog.js'

export function isLocalProvider(provider: string): boolean {
  return provider === 'llamacpp'
}

export function createProvider(config: EthagentConfig, options: { mode?: SessionMode } = {}): Provider {
  const mode = options.mode ?? 'chat'
  const toolContext = { hasIdentity: Boolean(config.identity) }
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
      return new OpenAIChatProvider({
        id: 'openai',
        model: config.model,
        baseUrl: openAIBaseUrlFor(config),
        loadApiKey: () => getKey('openai'),
        tools: openAITools(mode, toolContext),
      })
    case 'anthropic':
      return new AnthropicProvider({ model: config.model, tools: anthropicTools(mode, toolContext) })
    case 'gemini':
      return new GeminiProvider({ model: config.model })
  }
}
