import type { ProviderId } from '../storage/config.js'

export type CloudProviderId = Exclude<ProviderId, 'llamacpp'>

export function cloudProviderDisplayName(provider: CloudProviderId): string {
  switch (provider) {
    case 'openai': return 'OpenAI'
    case 'anthropic': return 'Anthropic'
    case 'gemini': return 'Gemini'
  }
}

export function providerDisplayName(provider: ProviderId): string {
  if (provider === 'llamacpp') return 'llama.cpp'
  return cloudProviderDisplayName(provider)
}
