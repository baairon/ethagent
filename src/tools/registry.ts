import type { AnthropicToolDefinition } from '../providers/anthropic.js'
import type { OpenAIToolDefinition } from '../providers/openai-chat.js'
import type { Tool } from './contracts.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import { modePolicy } from '../runtime/modePolicy.js'
import { bashTool } from './Bash.js'
import { changeDirectoryTool } from './ChangeDirectory.js'
import { deleteFileTool } from './DeleteFile.js'
import { editTool } from './Edit.js'
import { listDirectoryTool } from './ListDirectory.js'
import { readTool } from './Read.js'
import { writeFileTool } from './WriteFile.js'

export const BUILTIN_TOOLS: Tool[] = [changeDirectoryTool, listDirectoryTool, readTool, writeFileTool, editTool, deleteFileTool, bashTool]

export function getTool(name: string): Tool | undefined {
  return BUILTIN_TOOLS.find(tool => tool.name === name)
}

export function toolsForMode(mode: SessionMode = 'chat'): Tool[] {
  const policy = modePolicy(mode)
  return BUILTIN_TOOLS.filter(tool => policy.exposesToolKind(tool.kind))
}

export function anthropicTools(mode: SessionMode = 'chat'): AnthropicToolDefinition[] {
  return toolsForMode(mode).map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchemaJson,
  }))
}

export function openAITools(mode: SessionMode = 'chat'): OpenAIToolDefinition[] {
  return toolsForMode(mode).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchemaJson,
    },
  }))
}
