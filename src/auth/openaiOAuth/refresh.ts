import {
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_TOKEN_URL,
  asTrimmedString,
  parseChatgptAccountId,
} from './shared.js'
import type { OpenAIOAuthCredentials } from './credentials.js'

export type RefreshedTokens = {
  accessToken: string
  refreshToken: string
  idToken?: string
  accountId?: string
  expiresIn: number
}

const REFRESH_LEEWAY_MS = 60_000

export function shouldRefresh(creds: OpenAIOAuthCredentials, now: number = Date.now()): boolean {
  return now >= creds.expiresAt - REFRESH_LEEWAY_MS
}

export async function refreshOpenAIAccessToken(refreshToken: string): Promise<RefreshedTokens> {
  const body = new URLSearchParams({
    client_id: OPENAI_OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      errorText.trim()
        ? `OpenAI token refresh failed (${response.status}): ${errorText.trim()}`
        : `OpenAI token refresh failed with status ${response.status}.`,
    )
  }

  const payload = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    id_token?: string
    expires_in?: number
  }
  const accessToken = asTrimmedString(payload.access_token)
  if (!accessToken) {
    throw new Error('OpenAI token refresh succeeded without a new access token.')
  }
  const nextRefresh = asTrimmedString(payload.refresh_token) ?? refreshToken
  const idToken = asTrimmedString(payload.id_token)
  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0
    ? payload.expires_in
    : 3600
  const accountId = parseChatgptAccountId(idToken) ?? parseChatgptAccountId(accessToken)

  return {
    accessToken,
    refreshToken: nextRefresh,
    idToken,
    accountId,
    expiresIn,
  }
}
