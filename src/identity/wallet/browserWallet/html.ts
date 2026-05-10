import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { normalizeWalletPayloadPurpose } from '../walletPurposeCompat.js'

const WALLET_PAGE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'page.tsx')
const WALLET_PAGE_MODULE_FILES = [
  join('page', 'types.ts'),
  join('page', 'html.ts'),
  join('page', 'constants.ts'),
  join('page', 'styles', 'base.ts'),
  join('page', 'styles', 'components.ts'),
  join('page', 'styles', 'responsive.ts'),
  join('page', 'styles', 'index.ts'),
  join('page', 'markup.ts'),
  join('page', 'grainient.ts'),
  join('page', 'state.ts'),
  join('page', 'copy.ts'),
  join('page', 'walletProvider.ts'),
  join('page', 'view.ts'),
  join('page', 'controller.ts'),
] as const
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

function loadWalletPageSource(): string {
  const pageFile = locateWalletPageFile()
  const pageDir = dirname(pageFile)
  const files = [
    ...WALLET_PAGE_MODULE_FILES.map(file => join(pageDir, file)),
    pageFile,
  ]
  return stripWalletModuleSyntax(files.map(file => readFileSync(file, 'utf8')).join('\n'))
}

function stripWalletModuleSyntax(source: string): string {
  const out: string[] = []
  let skippingImport = false
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (skippingImport) {
      if (/\bfrom\s+['"][^'"]+['"]/.test(trimmed) || trimmed.endsWith(';')) skippingImport = false
      continue
    }
    if (trimmed.startsWith('import ')) {
      if (!/\bfrom\s+['"][^'"]+['"]/.test(trimmed) && !trimmed.endsWith(';')) skippingImport = true
      continue
    }
    out.push(line.replace(/^export\s+(?=(async\s+function|const|let|function|interface|type|class)\b)/, ''))
  }
  return out.join('\n')
}

function locateWalletPageFile(): string {
  try {
    statSync(WALLET_PAGE_FILE)
    return WALLET_PAGE_FILE
  } catch {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'src', 'identity', 'wallet', 'page.tsx')
  }
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
