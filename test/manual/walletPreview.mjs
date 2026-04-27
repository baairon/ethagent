import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number.parseInt(process.env.PORT ?? '4173', 10)
const previewDir = fileURLToPath(new URL('./wallet-preview/', import.meta.url))
const walletDir = fileURLToPath(new URL('../../src/identity/wallet-page/', import.meta.url))
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    const baseDir = pathname === '/wallet.html' ? walletDir : previewDir
    const filePath = normalize(join(baseDir, pathname))
    if (!filePath.startsWith(baseDir)) throw new Error('invalid preview path')
    const body = await readFile(filePath)
    res.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (err) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end((err && err.message) || 'not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`wallet preview: http://127.0.0.1:${port}/`)
})
