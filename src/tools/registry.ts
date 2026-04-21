import type { AnthropicToolDefinition } from '../providers/anthropic.js'
import type { OpenAIToolDefinition } from '../providers/openai-chat.js'
import type { Tool } from './contracts.js'
import { bashTool } from './Bash.js'
import { changeDirectoryTool } from './ChangeDirectory.js'
import { editTool } from './Edit.js'
import { listDirectoryTool } from './ListDirectory.js'
import { readTool } from './Read.js'

export const BUILTIN_TOOLS: Tool[] = [changeDirectoryTool, listDirectoryTool, readTool, editTool, bashTool]

export function getTool(name: string): Tool | undefined {
  return BUILTIN_TOOLS.find(tool => tool.name === name)
}

export function anthropicTools(): AnthropicToolDefinition[] {
  return BUILTIN_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchemaJson,
  }))
}

export function openAITools(): OpenAIToolDefinition[] {
  return BUILTIN_TOOLS.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchemaJson,
    },
  }))
}
