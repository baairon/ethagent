export function syncGeneratedMarkdown(existing: string, fresh: string): string {
  return ensureTrailingNewline(replaceFirstHeading(existing, firstHeading(fresh)))
}

function firstHeading(markdown: string): string {
  return markdown.split(/\r?\n/).find(line => line.startsWith('# ')) ?? ''
}

function replaceFirstHeading(markdown: string, heading: string): string {
  if (!heading) return markdown
  const lines = markdown.split(/\r?\n/)
  const index = lines.findIndex(line => line.startsWith('# '))
  if (index === -1) return `${heading}\n\n${markdown.trimStart()}`
  lines[index] = heading
  return lines.join('\n')
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
