import { getSecret, rmSecret, setSecret } from '../../storage/secrets.js'

const ACCOUNT = 'openai-oauth'

export type OpenAIOAuthCredentials = {
  accessToken: string
  refreshToken: string
  idToken?: string
  accountId?: string
  expiresAt: number
  lastRefreshAt: number
}

export async function getOpenAIOAuthCredentials(): Promise<OpenAIOAuthCredentials | null> {
  const raw = await getSecret(ACCOUNT)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<OpenAIOAuthCredentials>
    if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) return null
    if (typeof parsed.refreshToken !== 'string' || !parsed.refreshToken) return null
    if (typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)) return null
    if (typeof parsed.lastRefreshAt !== 'number' || !Number.isFinite(parsed.lastRefreshAt)) return null
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : undefined,
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
      expiresAt: parsed.expiresAt,
      lastRefreshAt: parsed.lastRefreshAt,
    }
  } catch {
    return null
  }
}

export async function setOpenAIOAuthCredentials(creds: OpenAIOAuthCredentials): Promise<void> {
  await setSecret(ACCOUNT, JSON.stringify(creds))
}

export async function rmOpenAIOAuthCredentials(): Promise<void> {
  await rmSecret(ACCOUNT)
}

export async function hasOpenAIOAuthCredentials(): Promise<boolean> {
  const creds = await getOpenAIOAuthCredentials()
  return creds !== null
}
