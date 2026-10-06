export function wrapWords(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width))
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      if (!line) {
        line = word
      } else if (line.length + 1 + word.length <= limit) {
        line = `${line} ${word}`
      } else {
        out.push(line)
        line = word
      }
      while (line.length > limit) {
        out.push(line.slice(0, limit))
        line = line.slice(limit)
      }
    }
    if (line) out.push(line)
  }
  return out
}

export function firstThatFits(candidates: readonly string[], budget: number): string | null {
  for (const candidate of candidates) {
    if (candidate.length <= budget) return candidate
  }
  return null
}

export function joinWithMore(items: readonly string[], budget: number, separator = ', '): string | null {
  const all = items.join(separator)
  if (all.length <= budget) return all
  for (let shown = items.length - 1; shown >= 1; shown -= 1) {
    const candidate = `${items.slice(0, shown).join(separator)} +${items.length - shown} more`
    if (candidate.length <= budget) return candidate
  }
  return null
}

export function middleEllipsis(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
