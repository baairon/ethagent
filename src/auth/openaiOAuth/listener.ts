import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export class AuthCodeListener {
  private localServer: Server
  private port = 0
  private promiseResolver: ((authorizationCode: string) => void) | null = null
  private promiseRejecter: ((error: Error) => void) | null = null
  private expectedState: string | null = null
  private pendingResponse: ServerResponse | null = null
  private readonly callbackPath: string

  constructor(callbackPath = '/auth/callback') {
    this.localServer = createServer()
    this.callbackPath = callbackPath
  }

  async start(port?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error): void => {
        reject(new Error(`Failed to start OAuth callback server: ${err.message}`))
      }
      this.localServer.once('error', onError)
      this.localServer.listen(port ?? 0, 'localhost', () => {
        this.localServer.removeListener('error', onError)
        const address = this.localServer.address() as AddressInfo
        this.port = address.port
        resolve(this.port)
      })
    })
  }

  getPort(): number {
    return this.port
  }

  hasPendingResponse(): boolean {
    return this.pendingResponse !== null
  }

  async waitForAuthorization(
    state: string,
    onReady: () => Promise<void> | void,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.promiseResolver = resolve
      this.promiseRejecter = reject
      this.expectedState = state
      this.localServer.on('request', this.handleRedirect.bind(this))
      this.localServer.on('error', err => this.cancelPendingAuthorization(err))
      void Promise.resolve(onReady()).catch(err => this.cancelPendingAuthorization(err as Error))
    })
  }

  handleSuccessRedirect(
    _scopes: string[],
    customHandler?: (res: ServerResponse) => void,
  ): void {
    if (!this.pendingResponse) return
    const response = this.pendingResponse
    try {
      if (customHandler) customHandler(response)
      else {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('OpenAI sign-in complete. You can close this tab.')
      }
      if (!response.writableEnded && !response.destroyed) response.end()
    } finally {
      this.pendingResponse = null
    }
  }

  handleErrorRedirect(customHandler?: (res: ServerResponse) => void): void {
    if (!this.pendingResponse) return
    const response = this.pendingResponse
    try {
      if (customHandler) customHandler(response)
      else {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('OpenAI sign-in failed. You can close this tab.')
      }
      if (!response.writableEnded && !response.destroyed) response.end()
    } finally {
      this.pendingResponse = null
    }
  }

  cancelPendingAuthorization(error: Error = new Error('OAuth authorization was cancelled.')): void {
    this.reject(error)
    this.close()
  }

  private handleRedirect(req: IncomingMessage, res: ServerResponse): void {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
    if (parsedUrl.pathname !== this.callbackPath) {
      res.writeHead(404)
      res.end()
      return
    }
    const authCode = parsedUrl.searchParams.get('code') ?? undefined
    const state = parsedUrl.searchParams.get('state') ?? undefined
    this.validateAndRespond(authCode, state, res)
  }

  private validateAndRespond(
    authCode: string | undefined,
    state: string | undefined,
    res: ServerResponse,
  ): void {
    if (!authCode) {
      res.writeHead(400)
      res.end('Authorization code not found')
      this.reject(new Error('No authorization code received'))
      return
    }
    if (state !== this.expectedState) {
      res.writeHead(400)
      res.end('Invalid state parameter')
      this.reject(new Error('Invalid state parameter'))
      return
    }
    this.pendingResponse = res
    this.resolve(authCode)
  }

  private resolve(authorizationCode: string): void {
    if (this.promiseResolver) {
      this.promiseResolver(authorizationCode)
      this.promiseResolver = null
      this.promiseRejecter = null
      this.expectedState = null
    }
  }

  private reject(error: Error): void {
    if (this.promiseRejecter) {
      this.promiseRejecter(error)
      this.promiseResolver = null
      this.promiseRejecter = null
      this.expectedState = null
    }
  }

  close(): void {
    if (this.pendingResponse) this.handleErrorRedirect()
    this.localServer.removeAllListeners()
    this.localServer.close()
    this.expectedState = null
    this.port = 0
  }
}
