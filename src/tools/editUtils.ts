const LEFT_SINGLE_CURLY_QUOTE = '\u2018'
const RIGHT_SINGLE_CURLY_QUOTE = '\u2019'
const LEFT_DOUBLE_CURLY_QUOTE = '\u201c'
const RIGHT_DOUBLE_CURLY_QUOTE = '\u201d'

export type AppliedEdit = {
  before: string
  after: string
  summary: string
  previewBefore: string
  previewAfter: string
}

export function applyRequestedEdit(
  filePath: string,
  before: string,
  oldText: string | undefined,
  newText: string,
  replaceAll = false,
  _replaceWholeFile = false,
): AppliedEdit {
  if (!oldText) {
    if (newText.length === 0) {
      throw new Error('edit_file newText is empty; empty whole-file writes are not valid unless replacing a specific oldText range')
    }
    return {
      before,
      after: newText,
      summary: before.length === 0 ? `create ${filePath}` : `replace entire ${filePath}`,
      previewBefore: previewText(before),
      previewAfter: previewText(newText),
    }
  }

  if (replaceAll) {
    const matchCount = countOccurrences(before, oldText)
    if (matchCount === 0) throw new Error('oldText was not found in the file')
    return {
      before,
      after: before.replaceAll(oldText, () => newText),
      summary: `replace ${matchCount} match${matchCount === 1 ? '' : 'es'} in ${filePath}`,
      previewBefore: previewText(oldText),
      previewAfter: previewText(newText),
    }
  }

  const actualOldText = findUniqueEditableMatch(before, oldText)
  if (!actualOldText) throw new Error('oldText was not found in the file')
  if (countOccurrences(before, actualOldText) > 1) {
    throw new Error('oldText matched multiple locations; provide more context or use replaceAll')
  }

  const adjustedNewText = preserveQuoteStyle(oldText, actualOldText, newText)
  return {
    before,
    after: replaceSingleOccurrence(before, actualOldText, adjustedNewText),
    summary: `edit ${filePath}`,
    previewBefore: previewText(actualOldText),
    previewAfter: previewText(adjustedNewText),
  }
}

function replaceSingleOccurrence(content: string, search: string, replace: string): string {
  const index = content.indexOf(search)
  if (index === -1) throw new Error('oldText was not found in the file')
  return `${content.slice(0, index)}${replace}${content.slice(index + search.length)}`
}

function findUniqueEditableMatch(fileContent: string, searchText: string): string | null {
  const exactCount = countOccurrences(fileContent, searchText)
  if (exactCount === 1) return searchText
  if (exactCount > 1) return searchText

  const normalizedSearch = normalizeQuotes(searchText)
  const normalizedFile = normalizeQuotes(fileContent)
  const firstIndex = normalizedFile.indexOf(normalizedSearch)
  if (firstIndex === -1) return null

  const secondIndex = normalizedFile.indexOf(normalizedSearch, firstIndex + normalizedSearch.length)
  if (secondIndex !== -1) return null

  return fileContent.slice(firstIndex, firstIndex + searchText.length)
}

function countOccurrences(content: string, search: string): number {
  if (!search) return 0
  let count = 0
  let offset = 0
  while (true) {
    const index = content.indexOf(search, offset)
    if (index === -1) return count
    count += 1
    offset = index + search.length
  }
}

function normalizeQuotes(text: string): string {
  return text
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"')
}

function preserveQuoteStyle(oldText: string, actualOldText: string, newText: string): string {
  if (oldText === actualOldText) return newText

  let result = newText
  if (containsCurlyDoubleQuotes(actualOldText)) result = applyCurlyDoubleQuotes(result)
  if (containsCurlySingleQuotes(actualOldText)) result = applyCurlySingleQuotes(result)
  return result
}

function containsCurlyDoubleQuotes(text: string): boolean {
  return text.includes(LEFT_DOUBLE_CURLY_QUOTE) || text.includes(RIGHT_DOUBLE_CURLY_QUOTE)
}

function containsCurlySingleQuotes(text: string): boolean {
  return text.includes(LEFT_SINGLE_CURLY_QUOTE) || text.includes(RIGHT_SINGLE_CURLY_QUOTE)
}

function applyCurlyDoubleQuotes(text: string): string {
  const chars = [...text]
  const out: string[] = []

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (char !== '"') {
      out.push(char!)
      continue
    }
    out.push(isOpeningContext(chars, index) ? LEFT_DOUBLE_CURLY_QUOTE : RIGHT_DOUBLE_CURLY_QUOTE)
  }

  return out.join('')
}

function applyCurlySingleQuotes(text: string): string {
  const chars = [...text]
  const out: string[] = []

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (char !== "'") {
      out.push(char!)
      continue
    }

    const prev = index > 0 ? chars[index - 1] : undefined
    const next = index < chars.length - 1 ? chars[index + 1] : undefined
    if (prev && next && /\p{L}/u.test(prev) && /\p{L}/u.test(next)) {
      out.push(RIGHT_SINGLE_CURLY_QUOTE)
      continue
    }

    out.push(isOpeningContext(chars, index) ? LEFT_SINGLE_CURLY_QUOTE : RIGHT_SINGLE_CURLY_QUOTE)
  }

  return out.join('')
}

function isOpeningContext(chars: string[], index: number): boolean {
  if (index === 0) return true
  return [' ', '\t', '\n', '\r', '(', '[', '{'].includes(chars[index - 1] ?? '')
}

function previewText(text: string, max = 700): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
