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
    || (parsed ? friendlyFilename(parsed.filename) : modelId)
  if (!parsed && !label.includes(HF_SEPARATOR)) return truncateMiddle(label, maxLength)

  const parts = splitLocalHfDisplayName(label)
  if (!parts) return truncateMiddle(label, maxLength)
  return formatRepoAndFile(parts.repoId, parts.filename, maxLength)
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
