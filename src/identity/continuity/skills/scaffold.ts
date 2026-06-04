export function isDraftScaffold(entry: { description: string; name: string }): boolean {
  const desc = entry.description?.trim() ?? ''
  if (desc.length === 0) return true
  if (/^<.*>$/.test(desc)) return true
  if (desc === entry.name) return true
  if (/^overview$/i.test(desc)) return true
  if (/^describe in one or two sentences/i.test(desc)) return true
  if (/^replace this draft/i.test(desc)) return true
  return false
}
