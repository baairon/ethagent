import fs from 'node:fs/promises'
import path from 'node:path'
import type { ImageBlock, Message, MessageContentBlock } from '../providers/contracts.js'

const IMAGE_MARKER_RE = /\[image:\s*([^\]]+?)\]/gi
const PLACEHOLDER_RE = /^([<{[].*[>}\]]|#\d+)$/

export class ImageLoadError extends Error {
  readonly imagePath: string
  constructor(imagePath: string, message: string) {
    super(message)
    this.name = 'ImageLoadError'
    this.imagePath = imagePath
  }
}

export function collapseImagePathsToRefs(text: string): string {
  let counter = 0
  return text.replace(IMAGE_MARKER_RE, (full, raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || PLACEHOLDER_RE.test(trimmed)) return full
    counter += 1
    return `[Image #${counter}]`
  })
}

export function modelSupportsImages(
  provider: string,
  model: string,
  extra?: { mmprojPath?: string },
): boolean {
  const normalized = model.toLowerCase()
  switch (provider) {
    case 'anthropic':
      return /claude-3|claude-sonnet-4|claude-opus-4|claude-haiku-4/.test(normalized)
    case 'gemini':
      return /gemini-1\.5|gemini-2\.0|gemini-2\.5/.test(normalized)
    case 'openai':
      if (normalized.includes('gpt-3.5')) return false
      return /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|o1|o3|o4|chatgpt-4/.test(normalized)
    case 'llamacpp':
      return Boolean(extra?.mmprojPath)
    default:
      return false
  }
}

export function hasImageBlocks(messages: Message[]): boolean {
  return messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'image'))
}

export function userTextToContentBlocks(text: string): string | MessageContentBlock[] {
  const blocks = parseImageMarkers(text)
  return blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0].text : blocks
}

export function parseImageMarkers(text: string): MessageContentBlock[] {
  const out: MessageContentBlock[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = IMAGE_MARKER_RE.exec(text)) !== null) {
    const full = match[0]
    const rawPath = match[1]?.trim() ?? ''
    if (match.index > lastIndex) {
      const prefix = text.slice(lastIndex, match.index)
      if (prefix) out.push({ type: 'text', text: prefix })
    }
    if (rawPath && !PLACEHOLDER_RE.test(rawPath)) {
      out.push({ type: 'image', path: rawPath })
    } else {
      out.push({ type: 'text', text: full })
    }
    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    const suffix = text.slice(lastIndex)
    if (suffix) out.push({ type: 'text', text: suffix })
  }

  if (out.length === 0) return text ? [{ type: 'text', text }] : []
  return mergeAdjacentTextBlocks(out)
}

export async function loadImageBlock(block: ImageBlock): Promise<ImageBlock> {
  if (block.dataBase64 && block.mimeType) return block
  if (block.url) return block
  const rawPath = block.path?.trim() ?? ''
  if (!rawPath) throw new ImageLoadError(rawPath, 'image path is empty')
  if (PLACEHOLDER_RE.test(rawPath)) {
    throw new ImageLoadError(rawPath, `image path looks like a placeholder, not a real file: ${rawPath}`)
  }
  let file: Buffer
  try {
    file = await fs.readFile(rawPath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new ImageLoadError(rawPath, `image file not found: ${rawPath}`)
    }
    throw new ImageLoadError(rawPath, `could not read image at ${rawPath}: ${(err as Error).message}`)
  }
  const mimeType = block.mimeType ?? mimeTypeForPath(rawPath)
  return {
    ...block,
    path: rawPath,
    mimeType,
    dataBase64: file.toString('base64'),
  }
}

export function imagePlaceholder(pathValue: string): string {
  return `[image: ${path.basename(pathValue)}]`
}

function mergeAdjacentTextBlocks(blocks: MessageContentBlock[]): MessageContentBlock[] {
  const out: MessageContentBlock[] = []
  for (const block of blocks) {
    const prev = out[out.length - 1]
    if (block.type === 'text' && prev?.type === 'text') {
      prev.text += block.text
      continue
    }
    out.push(block)
  }
  return out
}

function mimeTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}
