export const OPENAI_OAUTH_ISSUER = 'https://auth.openai.com'
export const OPENAI_OAUTH_TOKEN_URL = `${OPENAI_OAUTH_ISSUER}/oauth/token`
export const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_OAUTH_CALLBACK_PORT = 1455
export const OPENAI_OAUTH_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke'
export const OPENAI_OAUTH_ORIGINATOR = 'codex_cli_rs'
export const OPENAI_API_KEY_TOKEN_NAME = 'openai-api-key'
export const OPENAI_ID_TOKEN_SUBJECT_TYPE =
  'urn:ietf:params:oauth:token-type:id_token'
export const OPENAI_TOKEN_EXCHANGE_GRANT =
  'urn:ietf:params:oauth:grant-type:token-exchange'

export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  const segment = parts[1]
  if (!segment) return undefined

  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function parseChatgptAccountId(
  token: string | undefined,
): string | undefined {
  if (!token) return undefined

  const payload = decodeJwtPayload(token)
  const nestedAuthRaw = payload?.['https://api.openai.com/auth']
  const nestedAuth =
    nestedAuthRaw && typeof nestedAuthRaw === 'object'
      ? (nestedAuthRaw as Record<string, unknown>)
      : undefined

  return (
    asTrimmedString(
      nestedAuth?.chatgpt_account_id ??
        payload?.['https://api.openai.com/auth.chatgpt_account_id'] ??
        payload?.chatgpt_account_id,
    ) ?? undefined
  )
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case '\'':
        return '&#39;'
      default:
        return char
    }
  })
}

export async function exchangeIdTokenForApiKey(idToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: OPENAI_TOKEN_EXCHANGE_GRANT,
    client_id: OPENAI_OAUTH_CLIENT_ID,
    requested_token: OPENAI_API_KEY_TOKEN_NAME,
    subject_token: idToken,
    subject_token_type: OPENAI_ID_TOKEN_SUBJECT_TYPE,
  })

  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      bodyText.trim()
        ? `OpenAI API key exchange failed (${response.status}): ${bodyText.trim()}`
        : `OpenAI API key exchange failed with status ${response.status}.`,
    )
  }

  const payload = (await response.json()) as { access_token?: string }
  const apiKey = asTrimmedString(payload.access_token)
  if (!apiKey) {
    throw new Error(
      'OpenAI API key exchange completed, but no key was returned.',
    )
  }

  return apiKey
}
