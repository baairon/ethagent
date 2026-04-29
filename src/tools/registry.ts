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
import { privateContinuityEditTool } from './PrivateContinuityEdit.js'
import { privateContinuityReadTool } from './PrivateContinuityRead.js'
import { readTool } from './Read.js'
import { writeFileTool } from './WriteFile.js'

export const BUILTIN_TOOLS: Tool[] = [
  changeDirectoryTool,
  listDirectoryTool,
  readTool,
  privateContinuityReadTool,
  writeFileTool,
  editTool,
  privateContinuityEditTool,
  deleteFileTool,
  bashTool,
]

export type ToolAvailabilityContext = {
  hasIdentity?: boolean
}

export function getTool(name: string): Tool | undefined {
  return BUILTIN_TOOLS.find(tool => tool.name === name)
}

export function toolsForMode(mode: SessionMode = 'chat', context: ToolAvailabilityContext = {}): Tool[] {
  const policy = modePolicy(mode)
  return BUILTIN_TOOLS.filter(tool => {
    if (!policy.exposesToolKind(tool.kind)) return false
    if ((tool.kind === 'private-continuity-read' || tool.kind === 'private-continuity-edit') && !context.hasIdentity) return false
    return true
  })
}

export function anthropicTools(mode: SessionMode = 'chat', context: ToolAvailabilityContext = {}): AnthropicToolDefinition[] {
  return toolsForMode(mode, context).map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchemaJson,
  }))
}

export function openAITools(mode: SessionMode = 'chat', context: ToolAvailabilityContext = {}): OpenAIToolDefinition[] {
  return toolsForMode(mode, context).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchemaJson,
    },
  }))
}
