import type { Message, MessageContentBlock } from './contracts.js'
import { messageTextContent } from '../utils/messages.js'
import { loadImageBlock } from '../utils/images.js'

export async function toWireMessages(messages: Message[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content })
      continue
    }

    if (message.role === 'user') {
      const toolResults = message.content.filter(isToolResultBlock)
      if (toolResults.length > 0) {
        for (const block of toolResults) {
          out.push({
            role: 'tool',
            tool_call_id: block.toolUseId,
            content: block.content,
          })
        }
        const nonToolBlocks = message.content.filter(block => block.type !== 'tool_result')
        if (nonToolBlocks.length > 0) {
          out.push({ role: 'user', content: await toOpenAIUserContent(nonToolBlocks) })
        }
        continue
      }
      out.push({ role: 'user', content: await toOpenAIUserContent(message.content) })
      continue
    }

    if (message.role === 'assistant') {
      const textParts = message.content.filter(isTextBlock).map(block => block.text)
      const toolCalls = message.content.filter(isToolUseBlock).map(block => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      }))
      out.push({
        role: 'assistant',
        content: textParts.join(''),
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      })
      continue
    }

    const toolResults = message.content.filter(isToolResultBlock)
    if (toolResults.length > 0) {
      for (const block of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: block.content,
        })
      }
      continue
    }

    out.push({ role: message.role, content: messageTextContent(message) })
  }

  return normalizeSystemMessages(out)
}

async function toOpenAIUserContent(blocks: MessageContentBlock[]): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      const loaded = await loadImageBlock(block)
      if (loaded.url) {
        parts.push({ type: 'image_url', image_url: { url: loaded.url } })
      } else if (loaded.dataBase64 && loaded.mimeType) {
        parts.push({ type: 'image_url', image_url: { url: `data:${loaded.mimeType};base64,${loaded.dataBase64}` } })
      }
      continue
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

function normalizeSystemMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const systemContents: string[] = []
  const nonSystem: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (typeof message.content === 'string' && message.content.length > 0) {
        systemContents.push(message.content)
      }
      continue
    }
    nonSystem.push(message)
  }

  if (systemContents.length === 0) return nonSystem
  return [
    {
      role: 'system',
      content: systemContents.join('\n\n'),
    },
    ...nonSystem,
  ]
}

function isTextBlock(block: MessageContentBlock): block is Extract<MessageContentBlock, { type: 'text' }> {
  return block.type === 'text'
}

function isToolUseBlock(block: MessageContentBlock): block is Extract<MessageContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use'
}

function isToolResultBlock(block: MessageContentBlock): block is Extract<MessageContentBlock, { type: 'tool_result' }> {
  return block.type === 'tool_result'
}
