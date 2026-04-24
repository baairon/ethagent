import type { EthagentConfig } from '../storage/config.js'
import { defaultBaseUrlFor } from '../storage/config.js'
import { getKey } from '../storage/secrets.js'
import type { Provider } from './contracts.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import { OpenAIChatProvider } from './openai-chat.js'
import { anthropicTools, openAITools } from '../tools/registry.js'
import { openAIBaseUrlFor } from '../models/catalog.js'

export function isLocalProvider(provider: string): boolean {
  return provider === 'ollama'
}

export function createProvider(config: EthagentConfig, options: { mode?: SessionMode } = {}): Provider {
  const mode = options.mode ?? 'chat'
  switch (config.provider) {
    case 'ollama':
      return new OpenAIChatProvider({
        id: 'ollama',
        model: config.model,
        baseUrl: config.baseUrl ?? defaultBaseUrlFor('ollama') ?? 'http://localhost:11434/v1',
        apiKey: 'ollama',
        tools: openAITools(mode),
      })
    case 'openai':
      return new OpenAIChatProvider({
        id: 'openai',
        model: config.model,
        baseUrl: openAIBaseUrlFor(config),
        loadApiKey: () => getKey('openai'),
        tools: openAITools(mode),
      })
    case 'anthropic':
      return new AnthropicProvider({ model: config.model, tools: anthropicTools(mode) })
    case 'gemini':
      return new GeminiProvider({ model: config.model })
  }
}
