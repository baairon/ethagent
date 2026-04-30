import type { ProviderId } from '../storage/config.js'
import { ProviderError } from './contracts.js'

type ErrorBody =
  | string
  | {
      error?: {
        message?: string
        type?: string
      }
      message?: string
      detail?: string
    }

export async function providerErrorFromResponse(
  provider: ProviderId,
  response: Response,
): Promise<ProviderError> {
  const detail = await readErrorDetail(response)

  if (provider !== 'llamacpp') {
    if (response.status === 401 || response.status === 403) {
      return new ProviderError(`auth failed: check your ${provider} key (/doctor to verify)`)
    }
    if (response.status === 429) {
      return new ProviderError(detail || `${provider} rate limit exceeded`, { transient: true })
    }
    if (response.status >= 500) {
      return new ProviderError(detail || `${provider} server error (${response.status})`, { transient: true })
    }
  }

  return new ProviderError(
    detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
    { transient: response.status === 429 || response.status >= 500 },
  )
}

async function readErrorDetail(response: Response): Promise<string> {
  let text = ''
  try {
    text = (await response.text()).trim()
  } catch {
    return ''
  }
  if (!text) return ''

  try {
    const parsed = JSON.parse(text) as ErrorBody
    const nestedMessage =
      typeof parsed === 'object' && parsed !== null
        ? parsed.error?.message ?? parsed.message ?? parsed.detail ?? ''
        : ''
    return normalizeDetail(nestedMessage || text)
  } catch {
    return normalizeDetail(text)
  }
}

function normalizeDetail(detail: string): string {
  return detail.replace(/\s+/g, ' ').trim().slice(0, 400)
}
