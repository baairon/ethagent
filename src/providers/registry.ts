import type { EthagentConfig } from '../storage/config.js'
import { defaultBaseUrlFor } from '../storage/config.js'
import { getKey } from '../storage/secrets.js'
import type { Provider } from './contracts.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import { OpenAIChatProvider } from './openai-chat.js'

export function createProvider(config: EthagentConfig): Provider {
  switch (config.provider) {
    case 'ollama':
      return new OpenAIChatProvider({
        id: 'ollama',
        model: config.model,
        baseUrl: config.baseUrl ?? defaultBaseUrlFor('ollama') ?? 'http://localhost:11434/v1',
        apiKey: 'ollama',
      })
    case 'openai':
      return new OpenAIChatProvider({
        id: 'openai',
        model: config.model,
        baseUrl: 'https://api.openai.com/v1',
        loadApiKey: () => getKey('openai'),
      })
    case 'anthropic':
      return new AnthropicProvider({ model: config.model })
    case 'gemini':
      return new GeminiProvider({ model: config.model })
  }
}
