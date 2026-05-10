type SyncBlock = {
  marker: string
}

export function renderPrivateIdentityBlock(args: {
  owner: string
  token: string
  chainId: string
  registry: string
}): string {
  return [
    '<!-- ethagent:identity:start -->',
    '## Agent Identity',
    `- Owner wallet: ${args.owner}`,
    `- ERC-8004 token: ${args.token}`,
    `- Chain ID: ${args.chainId}`,
    `- Registry: ${args.registry}`,
    '- Visibility: private local working file; encrypted before IPFS backup.',
    '<!-- ethagent:identity:end -->',
  ].join('\n')
}

export function syncGeneratedMarkdown(existing: string, fresh: string, blocks: SyncBlock[]): string {
  let next = replaceFirstHeading(existing, firstHeading(fresh))
  for (const block of blocks) {
    next = replaceOrInsertMarkedBlock(next, fresh, block)
  }
  return ensureTrailingNewline(next)
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

function replaceOrInsertMarkedBlock(markdown: string, fresh: string, block: SyncBlock): string {
  const freshBlock = extractMarkedBlock(fresh, block.marker)
  if (!freshBlock) return markdown
  const replaced = replaceMarkedBlock(markdown, block.marker, freshBlock)
  if (replaced) return replaced
  return insertAfterFirstHeading(markdown, freshBlock)
}

function extractMarkedBlock(markdown: string, marker: string): string | null {
  const start = `<!-- ethagent:${marker}:start -->`
  const end = `<!-- ethagent:${marker}:end -->`
  const startIndex = markdown.indexOf(start)
  const endIndex = markdown.indexOf(end, startIndex + start.length)
  if (startIndex === -1 || endIndex === -1) return null
  return markdown.slice(startIndex, endIndex + end.length).trim()
}

function replaceMarkedBlock(markdown: string, marker: string, replacement: string): string | null {
  const start = `<!-- ethagent:${marker}:start -->`
  const end = `<!-- ethagent:${marker}:end -->`
  const startIndex = markdown.indexOf(start)
  const endIndex = markdown.indexOf(end, startIndex + start.length)
  if (startIndex === -1 || endIndex === -1) return null
  return `${markdown.slice(0, startIndex)}${replacement}${markdown.slice(endIndex + end.length)}`
}

function insertAfterFirstHeading(markdown: string, block: string): string {
  const lines = markdown.split(/\r?\n/)
  const headingIndex = lines.findIndex(line => line.startsWith('# '))
  if (headingIndex === -1) return `${block}\n\n${markdown.trimStart()}`
  const before = lines.slice(0, headingIndex + 1)
  const after = lines.slice(headingIndex + 1)
  return [...before, '', block, '', ...after].join('\n')
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
