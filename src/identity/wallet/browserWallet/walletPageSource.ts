import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WALLET_PAGE_DIR = 'page'

const WALLET_PAGE_PARTS = [
  'types.ts',
  'constants.ts',
  'css.ts',
  'svg.ts',
  'markup.ts',
  'config.ts',
  'copy.ts',
  'errors.ts',
  'provider.ts',
  'view.ts',
  'timeline.ts',
  'state.ts',
  'flow.ts',
  'boot.ts',
]

export function loadWalletPageRawSource(fromUrl = import.meta.url): string {
  const dir = locateWalletPageSourceRoot(fromUrl)
  return WALLET_PAGE_PARTS.map(part => readFileSync(join(dir, part), 'utf8')).join('\n')
}

export function loadWalletPageSource(fromUrl = import.meta.url): string {
  return stripWalletModuleSyntax(loadWalletPageRawSource(fromUrl))
}

export function stripWalletModuleSyntax(source: string): string {
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

function locateWalletPageSourceRoot(fromUrl: string): string {
  for (const candidate of walletPageSourceRootCandidates(fromUrl)) {
    if (existsSync(join(candidate, WALLET_PAGE_PARTS[0]!))) return candidate
  }
  throw new Error('could not locate browser wallet page source files')
}

function walletPageSourceRootCandidates(fromUrl: string): string[] {
  const start = dirname(fileURLToPath(fromUrl))
  const candidates = [join(start, '..', WALLET_PAGE_DIR)]
  for (let dir = start; ; dir = dirname(dir)) {
    candidates.push(join(dir, 'src', 'identity', 'wallet', WALLET_PAGE_DIR))
    const parent = dirname(dir)
    if (parent === dir) break
  }
  return Array.from(new Set(candidates))
}
