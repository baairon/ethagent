import { transformSync } from 'esbuild'
import { normalizeWalletPayloadPurpose } from '../walletPurposeCompat.js'
import { loadWalletPageSource } from './walletPageSource.js'

const WALLET_HTML = loadWalletHtml()

export function walletPage(title: string, sessionToken: string, payload: Record<string, unknown>): string {
  const config = JSON.stringify({ sessionToken, ...normalizeWalletPayloadPurpose(payload) }).replaceAll('<', '\\u003c')
  const injection = `<script>window.__WALLET_CONFIG__ = ${config};</script>`
  return WALLET_HTML
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('<head>', `<head>\n  ${injection}`)
}

export function __testWalletPage(title: string, sessionToken: string, payload: Record<string, unknown>): string {
  return walletPage(title, sessionToken, payload)
}

function loadWalletHtml(): string {
  const compiled = transformSync(loadWalletPageSource(), {
    loader: 'ts',
    target: 'es2020',
  }).code
  return wrapInWalletShell(compiled)
}

function wrapInWalletShell(compiledJs: string): string {
  const safeJs = compiledJs.replaceAll('</', '<\\/')
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wallet Request</title>
</head>
<body>
  <script>
${safeJs}
  </script>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
