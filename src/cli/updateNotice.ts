type RegistryResponse = {
  ok?: boolean
  json: () => Promise<unknown>
}

type RegistryFetch = (url: string, init: { signal: AbortSignal }) => Promise<RegistryResponse>

const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/ethagent/latest'

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1
    if (a[i] < b[i]) return -1
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

export function formatUpdateNotice(currentVersion: string, latestVersion: string): string | null {
  if (!isNewerVersion(latestVersion, currentVersion)) return null
  return `✨ update available: ethagent ${currentVersion} -> ${latestVersion} · run npm i -g ethagent@latest`
}

export async function checkForUpdates(
  currentVersion: string,
  options: { fetchImpl?: RegistryFetch; timeoutMs?: number } = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 1200
  try {
    const res = await fetchImpl(REGISTRY_LATEST_URL, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok === false) return null
    const body = await res.json()
    if (!body || typeof body !== 'object') return null
    const latest = (body as { version?: unknown }).version
    return typeof latest === 'string' ? formatUpdateNotice(currentVersion, latest) : null
  } catch {
    return null
  }
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
