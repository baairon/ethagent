export type JsonChange = { path: string; change: 'added' | 'removed' | 'modified'; before?: unknown; after?: unknown }

export function diffJson(a: unknown, b: unknown): JsonChange[] {
  const out: JsonChange[] = []
  walk(a, b, '', out)
  return out
}

export function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function arrayKey(items: unknown[]): 'id' | 'name' | null {
  for (const field of ['id', 'name'] as const) {
    const keys = items.map(item => (isObject(item) && typeof item[field] === 'string' ? item[field] : null))
    if (keys.every(key => key !== null) && new Set(keys).size === keys.length) return field
  }
  return null
}

function walk(a: unknown, b: unknown, path: string, out: JsonChange[]): void {
  if (isObject(a) && isObject(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = `${path}/${key}`
      if (!(key in a)) out.push({ path: next, change: 'added', after: b[key] })
      else if (!(key in b)) out.push({ path: next, change: 'removed', before: a[key] })
      else walk(a[key], b[key], next, out)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const field = arrayKey(a) && arrayKey(a) === arrayKey(b) ? arrayKey(a) : null
    if (field) {
      const byKey = (items: unknown[]): Map<string, unknown> =>
        new Map(items.map(item => [(item as Record<string, string>)[field]!, item]))
      const left = byKey(a)
      const right = byKey(b)
      for (const [key, item] of right) {
        const next = `${path}[${field}=${key}]`
        if (!left.has(key)) out.push({ path: next, change: 'added', after: item })
        else walk(left.get(key), item, next, out)
      }
      for (const [key, item] of left) {
        if (!right.has(key)) out.push({ path: `${path}[${field}=${key}]`, change: 'removed', before: item })
      }
      return
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const next = `${path}/${i}`
      if (i >= a.length) out.push({ path: next, change: 'added', after: b[i] })
      else if (i >= b.length) out.push({ path: next, change: 'removed', before: a[i] })
      else walk(a[i], b[i], next, out)
    }
    return
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || '/', change: 'modified', before: a, after: b })
}
