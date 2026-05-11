import { AuthCodeListener } from './listener.js'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './crypto.js'
import {
  OPENAI_OAUTH_CALLBACK_PORT,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_ISSUER,
  OPENAI_OAUTH_ORIGINATOR,
  OPENAI_OAUTH_SCOPE,
  OPENAI_OAUTH_TOKEN_URL,
  asTrimmedString,
  exchangeIdTokenForApiKey,
  parseChatgptAccountId,
} from './shared.js'
import { setOpenAIOAuthCredentials } from './credentials.js'
import { renderOAuthLandingPage } from './landingPage.js'

type OpenAIOAuthTokenResponse = {
  id_token?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

export type OpenAIOAuthResult =
  | { kind: 'apikey'; apiKey: string; accountId?: string }
  | { kind: 'oauth-only'; accountId?: string; reason?: string }

export type OpenAIOAuthOnReady = (authUrl: string) => void | Promise<void>

function buildAuthorizeUrl(args: { port: number; codeChallenge: string; state: string }): string {
  const redirectUri = `http://localhost:${args.port}/auth/callback`
  const params: Array<[string, string]> = [
    ['response_type', 'code'],
    ['client_id', OPENAI_OAUTH_CLIENT_ID],
    ['redirect_uri', redirectUri],
    ['scope', OPENAI_OAUTH_SCOPE],
    ['code_challenge', args.codeChallenge],
    ['code_challenge_method', 'S256'],
    ['id_token_add_organizations', 'true'],
    ['codex_cli_simplified_flow', 'true'],
    ['state', args.state],
    ['originator', OPENAI_OAUTH_ORIGINATOR],
  ]
  const qs = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${OPENAI_OAUTH_ISSUER}/oauth/authorize?${qs}`
}

function renderSuccessPage(): string {
  return renderOAuthLandingPage({
    tone: 'success',
    pageTitle: 'OpenAI Sign-in Complete',
    headline: 'OpenAI sign-in complete',
    message: 'You can return to your terminal.',
  })
}

function renderErrorPage(reason: string): string {
  return renderOAuthLandingPage({
    tone: 'error',
    pageTitle: 'OpenAI Sign-in Failed',
    headline: 'OpenAI sign-in failed',
    message: reason,
  })
}

function renderCancelledPage(): string {
  return renderOAuthLandingPage({
    tone: 'cancelled',
    pageTitle: 'OpenAI Sign-in Cancelled',
    headline: 'OpenAI sign-in cancelled',
    message: 'You can return to your terminal.',
  })
}

async function exchangeAuthorizationCode(args: {
  authorizationCode: string
  codeVerifier: string
  port: number
  signal: AbortSignal
}): Promise<OpenAIOAuthResult> {
  const redirectUri = `http://localhost:${args.port}/auth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.authorizationCode,
    redirect_uri: redirectUri,
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code_verifier: args.codeVerifier,
  })

  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.any([args.signal, AbortSignal.timeout(15_000)]),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      errorText.trim()
        ? `OpenAI OAuth token exchange failed (${response.status}): ${errorText.trim()}`
        : `OpenAI OAuth token exchange failed with status ${response.status}.`,
    )
  }

  const payload = (await response.json()) as OpenAIOAuthTokenResponse
  const accessToken = asTrimmedString(payload.access_token)
  const refreshToken = asTrimmedString(payload.refresh_token)
  const idToken = asTrimmedString(payload.id_token)
  if (!accessToken || !refreshToken) {
    throw new Error('OpenAI OAuth completed, but the response was missing access_token or refresh_token.')
  }

  const accountId = parseChatgptAccountId(idToken) ?? parseChatgptAccountId(accessToken)
  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0
    ? payload.expires_in
    : 3600
  const now = Date.now()
  await setOpenAIOAuthCredentials({
    accessToken,
    refreshToken,
    idToken,
    accountId,
    expiresAt: now + expiresIn * 1000,
    lastRefreshAt: now,
  })

  if (!idToken) {
    return { kind: 'oauth-only', accountId, reason: 'no id_token returned' }
  }

  try {
    const apiKey = await exchangeIdTokenForApiKey(idToken)
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return { kind: 'oauth-only', accountId, reason: 'API key exchange returned an empty token' }
    }
    return { kind: 'apikey', apiKey, accountId }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { kind: 'oauth-only', accountId, reason }
  }
}

export class OpenAIOAuthService {
  private listener: AuthCodeListener | null = null
  private exchangeAbort: AbortController | null = null

  async start(onReady: OpenAIOAuthOnReady): Promise<OpenAIOAuthResult> {
    const codeVerifier = generateCodeVerifier()
    const listener = new AuthCodeListener('/auth/callback')
    this.listener = listener

    let port: number
    try {
      port = await listener.start(OPENAI_OAUTH_CALLBACK_PORT)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('EADDRINUSE') || message.includes(String(OPENAI_OAUTH_CALLBACK_PORT))) {
        listener.close()
        this.listener = null
        throw new Error(
          `OpenAI sign-in needs localhost:${OPENAI_OAUTH_CALLBACK_PORT} for its callback. Close any app already using that port and try again.`,
        )
      }
      listener.close()
      this.listener = null
      throw err
    }

    const state = generateState()
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const authUrl = buildAuthorizeUrl({ port, codeChallenge, state })

    try {
      const authorizationCode = await listener.waitForAuthorization(state, async () => {
        await onReady(authUrl)
      })

      const abort = new AbortController()
      this.exchangeAbort = abort
      let result: OpenAIOAuthResult
      try {
        result = await exchangeAuthorizationCode({
          authorizationCode,
          codeVerifier,
          port,
          signal: abort.signal,
        })
      } finally {
        if (this.exchangeAbort === abort) this.exchangeAbort = null
      }

      if (this.listener !== listener) {
        throw new Error('OpenAI sign-in was cancelled.')
      }

      listener.handleSuccessRedirect([], res => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(renderSuccessPage())
      })

      return result
    } catch (error) {
      const resolved = this.listener === listener
        ? error
        : new Error('OpenAI sign-in was cancelled.')

      if (listener.hasPendingResponse()) {
        const isCancellation = resolved instanceof Error && resolved.message === 'OpenAI sign-in was cancelled.'
        listener.handleErrorRedirect(res => {
          res.writeHead(isCancellation ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(isCancellation ? renderCancelledPage() : renderErrorPage(
            resolved instanceof Error ? resolved.message : String(resolved),
          ))
        })
      }
      throw resolved
    } finally {
      this.cleanup()
    }
  }

  cleanup(): void {
    const cancellationError = new Error('OpenAI sign-in was cancelled.')
    this.exchangeAbort?.abort(cancellationError)
    this.exchangeAbort = null
    if (this.listener?.hasPendingResponse()) {
      this.listener.handleErrorRedirect(res => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(renderCancelledPage())
      })
    }
    this.listener?.cancelPendingAuthorization(cancellationError)
    this.listener = null
  }
}
