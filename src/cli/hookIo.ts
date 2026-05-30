import path from 'node:path'

// Shared helpers for the Claude Code hook entrypoints (--sync-on-edit, --memory-guard).
// A hook receives the harness payload as JSON on stdin and may answer with JSON on stdout.

export async function readHookPayload(): Promise<Record<string, unknown> | null> {
  if (process.stdin.isTTY) return null
  let raw = ''
  try {
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    return null
  }
  raw = raw.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function hookFilePath(payload: Record<string, unknown> | null): string | null {
  const filePath = (payload?.tool_input as { file_path?: unknown } | undefined)?.file_path
  return typeof filePath === 'string' && filePath.length > 0 ? filePath : null
}

export function samePath(a: string, b: string): boolean {
  const na = path.resolve(a)
  const nb = path.resolve(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

// True when `file` is `dir` itself or sits anywhere beneath it. Compares on a
// separator boundary so `.../memory` does not match a sibling like `.../memory-notes`.
export function isWithinDir(dir: string, file: string): boolean {
  const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  const nd = fold(path.resolve(dir))
  const nf = fold(path.resolve(file))
  if (nd === nf) return true
  const prefix = nd.endsWith(path.sep) ? nd : nd + path.sep
  return nf.startsWith(prefix)
}
