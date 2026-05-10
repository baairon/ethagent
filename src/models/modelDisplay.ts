export type ModelDisplayProvider = string

type ModelDisplayOptions = {
  maxLength?: number
  displayName?: string
}

const DEFAULT_MODEL_DISPLAY_MAX = 64
const HF_SEPARATOR = ' / '

export function formatModelDisplayName(
  provider: ModelDisplayProvider,
  model: string,
  options: ModelDisplayOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_MODEL_DISPLAY_MAX
  if (provider === 'llamacpp') {
    return formatLocalHfModelDisplayName(model, {
      maxLength,
      displayName: options.displayName,
    })
  }
  return truncateMiddle(model, maxLength)
}

export function formatLocalHfModelDisplayName(
  modelId: string,
  options: ModelDisplayOptions = {},
): string {
  const maxLength = options.maxLength ?? DEFAULT_MODEL_DISPLAY_MAX
  const parsed = parseLocalHfModelId(modelId)
  const label = options.displayName?.trim()
  if (label) {
    const parts = splitLocalHfDisplayName(label)
    if (parts) return formatRepoAndFile(parts.repoId, parts.filename, maxLength)
    if (parsed) return formatRepoAndFile(parsed.repoId, parsed.filename, maxLength)
    return truncateMiddle(label, maxLength)
  }

  if (parsed) return formatRepoAndFile(parsed.repoId, parsed.filename, maxLength)
  return truncateMiddle(modelId, maxLength)
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  const remaining = maxLength - 3
  const head = Math.ceil(remaining / 2)
  const tail = Math.floor(remaining / 2)
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`
}

function parseLocalHfModelId(modelId: string): { repoId: string; filename: string } | null {
  const hash = modelId.indexOf('#')
  if (hash <= 0 || hash === modelId.length - 1) return null
  return {
    repoId: modelId.slice(0, hash),
    filename: modelId.slice(hash + 1),
  }
}

function splitLocalHfDisplayName(label: string): { repoId: string; filename: string } | null {
  const separator = label.indexOf(HF_SEPARATOR)
  if (separator <= 0 || separator === label.length - HF_SEPARATOR.length) return null
  return {
    repoId: label.slice(0, separator),
    filename: label.slice(separator + HF_SEPARATOR.length),
  }
}

function formatRepoAndFile(repoId: string, filename: string, maxLength: number): string {
  const file = friendlyFilename(filename)
  const full = `${repoId}${HF_SEPARATOR}${file}`
  if (full.length <= maxLength) return full

  const compactFile = compactModelFilename(file, maxLength)
  if (maxLength <= 32 || compactFile.length >= maxLength - HF_SEPARATOR.length - 6) {
    return truncateEndClean(compactFile, maxLength)
  }

  const repoBudget = maxLength - HF_SEPARATOR.length - compactFile.length
  const compactRepo = compactRepoId(repoId, repoBudget)
  if (compactRepo) {
    const compact = `${compactRepo}${HF_SEPARATOR}${compactFile}`
    if (compact.length <= maxLength) return compact
  }

  const separatorBudget = HF_SEPARATOR.length
  const partBudget = maxLength - separatorBudget
  if (partBudget <= 8) return truncateMiddle(full, maxLength)

  let repoMax = Math.min(repoId.length, Math.max(8, Math.floor(partBudget * 0.45)))
  let fileMax = partBudget - repoMax

  if (fileMax > file.length) {
    repoMax = Math.min(repoId.length, repoMax + fileMax - file.length)
    fileMax = file.length
  }
  if (repoMax > repoId.length) {
    fileMax = Math.min(file.length, fileMax + repoMax - repoId.length)
    repoMax = repoId.length
  }
  if (fileMax < 8 && partBudget >= 16) {
    fileMax = 8
    repoMax = partBudget - fileMax
  }

  return truncateMiddle(
    `${truncateMiddle(repoId, repoMax)}${HF_SEPARATOR}${truncateMiddle(file, fileMax)}`,
    maxLength,
  )
}

function friendlyFilename(filename: string): string {
  return filename.split('/').pop() ?? filename
}

function compactRepoId(repoId: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (repoId.length <= maxLength) return repoId
  const parts = repoId.split('/').filter(Boolean)
  const owner = parts.length > 1 ? parts[0] ?? '' : ''
  const repoName = parts.at(-1) ?? repoId
  if (owner.length > 0) {
    const nameBudget = maxLength - owner.length - 1
    if (nameBudget >= 6) {
      const compactName = compactModelCore(repoName, nameBudget)
      const withOwner = `${owner}/${compactName}`
      if (withOwner.length <= maxLength) return withOwner
    }
  }
  return compactModelCore(repoName, maxLength)
}

function compactModelFilename(filename: string, maxLength: number): string {
  const withoutExtension = filename.replace(/\.gguf$/i, '')
  const compact = compactModelCore(withoutExtension, maxLength)
  if (compact.length <= maxLength) return compact
  return truncateEndClean(compact, maxLength)
}

function compactModelCore(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  const cleaned = value
    .replace(/\.gguf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/(^|[^0-9])\./g, '$1 ')
    .replace(/\.(?=[^0-9]|$)/g, ' ')
    .replace(/\bgguf\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return truncateEndClean(value, maxLength)

  const tokens = cleaned.split(' ')
  const sizeIndex = tokens.findIndex(token => /^\d+(?:\.\d+)?[bm]$/i.test(token))
  const familyTokens = sizeIndex > 0 ? tokens.slice(0, Math.min(sizeIndex, 3)) : tokens.slice(0, Math.min(tokens.length, 3))
  const size = sizeIndex >= 0 ? tokens[sizeIndex] : undefined
  const context = tokens.find(token => /^\d+k$/i.test(token))
  const quant = quantizationLabel(value)
  const parts = [familyTokens.join(' '), size, context, quant]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, all) => all.findIndex(other => other.toLowerCase() === part.toLowerCase()) === index)
  const compact = parts.join(' ').trim() || cleaned
  if (compact.length <= maxLength) return compact
  return truncateEndClean(compact, maxLength)
}

function quantizationLabel(value: string): string | undefined {
  const match = value.match(/(?:^|[-_.\s])((?:Q\d(?:_[A-Za-z0-9]+)*)|BF16|F16|FP16)(?:$|[-_.\s])/i)
  return match?.[1]?.toUpperCase()
}

function truncateEndClean(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  const sliced = value.slice(0, maxLength - 3).replace(/[\s._/-]+$/g, '')
  return `${sliced || value.slice(0, maxLength - 3)}...`
}
