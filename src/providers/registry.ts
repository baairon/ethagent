import type { EthagentConfig } from '../storage/config.js'
import { defaultBaseUrlFor } from '../storage/config.js'
import type { Provider } from './contracts.js'
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
    case 'anthropic':
    case 'gemini':
      throw new Error(`cloud provider '${config.provider}' lands in the next release.`)
  }
}
