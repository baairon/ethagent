import http from 'node:http'

export async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = raw ? JSON.parse(raw) as unknown : {}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be a JSON object')
  return parsed as Record<string, unknown>
}

export function respondHtml(res: http.ServerResponse, body: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

export function respondJson(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function isAllowedWalletOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin && origin !== 'null') {
    try {
      if (!isLoopbackHost(new URL(origin).host)) return false
    } catch {
      return false
    }
  }
  return isLoopbackHost(req.headers.host)
}
