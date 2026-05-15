import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WALLET_PAGE_ENTRY_FILE = 'page.tsx'
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
  join('page', 'errorView.ts'),
  join('page', 'walletProvider.ts'),
  join('page', 'view.ts'),
  join('page', 'controller.ts'),
] as const

export function walletPageSourceFiles(fromUrl = import.meta.url): string[] {
  const sourceRoot = locateWalletPageSourceRoot(fromUrl)
  return [
    ...WALLET_PAGE_MODULE_FILES.map(file => join(sourceRoot, file)),
    join(sourceRoot, WALLET_PAGE_ENTRY_FILE),
  ]
}

export function walletPageSourceFile(relativeFile: string, fromUrl = import.meta.url): string {
  return join(locateWalletPageSourceRoot(fromUrl), relativeFile)
}

export function loadWalletPageRawSource(fromUrl = import.meta.url): string {
  return walletPageSourceFiles(fromUrl).map(file => readFileSync(file, 'utf8')).join('\n')
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
    if (hasWalletPageSourceFiles(candidate)) return candidate
  }
  throw new Error('could not locate browser wallet page source files')
}

function walletPageSourceRootCandidates(fromUrl: string): string[] {
  const start = dirname(fileURLToPath(fromUrl))
  const candidates = [join(start, '..')]
  for (let dir = start; ; dir = dirname(dir)) {
    candidates.push(join(dir, 'src', 'identity', 'wallet'))
    const parent = dirname(dir)
    if (parent === dir) break
  }
  return Array.from(new Set(candidates))
}

function hasWalletPageSourceFiles(sourceRoot: string): boolean {
  return [
    ...WALLET_PAGE_MODULE_FILES,
    WALLET_PAGE_ENTRY_FILE,
  ].every(file => existsSync(join(sourceRoot, file)))
}
