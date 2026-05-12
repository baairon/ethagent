import type { Message, MessageContentBlock } from './contracts.js'
import { messageTextContent } from '../utils/messages.js'
import type { OpenAIToolDefinition } from './openai-chat.js'
import { loadImageBlock } from '../utils/images.js'

export type ResponsesInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string }

export type ResponsesInputItem =
  | { type: 'message'; role: 'user' | 'assistant'; content: ResponsesInputContent[] }
  | { type: 'function_call'; id?: string; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

export type ResponsesTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ResponsesRequestBody = {
  model: string
  input: ResponsesInputItem[]
  instructions?: string
  tools?: ResponsesTool[]
  tool_choice?: 'auto' | 'none' | 'required'
  parallel_tool_calls?: boolean
  stream: true
  store: false
  max_output_tokens?: number
}

export async function buildResponsesBody(args: {
  model: string
  messages: Message[]
  tools: OpenAIToolDefinition[]
  maxOutputTokens?: number
}): Promise<ResponsesRequestBody> {
  const { instructions, items } = await splitMessages(args.messages)
  const body: ResponsesRequestBody = {
    model: args.model,
    input: items,
    stream: true,
    store: false,
  }
  if (instructions) body.instructions = instructions
  if (args.tools.length > 0) {
    body.tools = args.tools.map(tool => ({
      type: 'function' as const,
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as Record<string, unknown>,
    }))
    body.parallel_tool_calls = true
    body.tool_choice = 'auto'
  }
  if (args.maxOutputTokens !== undefined) {
    body.max_output_tokens = args.maxOutputTokens
  }
  return body
}

async function splitMessages(messages: Message[]): Promise<{
  instructions?: string
  items: ResponsesInputItem[]
}> {
  const instructions: string[] = []
  const items: ResponsesInputItem[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      const text = typeof message.content === 'string'
        ? message.content
        : messageTextContent(message)
      if (text) instructions.push(text)
      continue
    }

    if (message.role === 'user') {
      const blocks = normalizeBlocks(message.content)
      const toolResults = blocks.filter(isToolResultBlock)
      if (toolResults.length > 0) {
        for (const block of toolResults) {
          items.push({
            type: 'function_call_output',
            call_id: block.toolUseId,
            output: block.content,
          })
        }
        const remainingText = blocks
          .filter(isTextBlock)
          .map(block => block.text)
          .join('')
        if (remainingText) {
          items.push({
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: remainingText }],
          })
        }
        continue
      }
      const content = await toOpenAIResponsesUserContent(blocks)
      if (content.length > 0) {
        items.push({
          type: 'message',
          role: 'user',
          content,
        })
      }
      continue
    }

    const blocks = normalizeBlocks(message.content)
    const text = blocks.filter(isTextBlock).map(block => block.text).join('')
    if (text) {
      items.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      })
    }
    for (const block of blocks.filter(isToolUseBlock)) {
      items.push({
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      })
    }
  }

  return {
    instructions: instructions.length > 0 ? instructions.join('\n\n') : undefined,
    items,
  }
}

async function toOpenAIResponsesUserContent(blocks: MessageContentBlock[]): Promise<ResponsesInputContent[]> {
  const content: ResponsesInputContent[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text) content.push({ type: 'input_text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      const loaded = await loadImageBlock(block)
      if (loaded.url) {
        content.push({ type: 'input_image', image_url: loaded.url })
      } else if (loaded.dataBase64 && loaded.mimeType) {
        content.push({ type: 'input_image', image_url: `data:${loaded.mimeType};base64,${loaded.dataBase64}` })
      }
    }
  }
  return content
}

function normalizeBlocks(content: Message['content']): MessageContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  return content
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
