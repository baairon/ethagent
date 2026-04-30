import type { AnthropicToolDefinition } from '../providers/anthropic.js'
import type { OpenAIToolDefinition } from '../providers/openai-chat.js'
import type { Tool } from './contracts.js'
import { modePolicy, type SessionMode } from '../runtime/sessionMode.js'
import { bashTool } from './bashTool.js'
import { changeDirectoryTool } from './changeDirectoryTool.js'
import { deleteFileTool } from './deleteFileTool.js'
import { editTool } from './editTool.js'
import { listDirectoryTool } from './listDirectoryTool.js'
import { privateContinuityEditTool } from './privateContinuityEditTool.js'
import { privateContinuityReadTool } from './privateContinuityReadTool.js'
import { readTool } from './readTool.js'
import { listMcpResourcesTool, readMcpResourceTool } from './mcpResourceTools.js'
import { writeFileTool } from './writeFileTool.js'

export const BUILTIN_TOOLS: Tool[] = [
  changeDirectoryTool,
  listDirectoryTool,
  readTool,
  privateContinuityReadTool,
  listMcpResourcesTool,
  readMcpResourceTool,
  writeFileTool,
  editTool,
  privateContinuityEditTool,
  deleteFileTool,
  bashTool,
]

export type ToolAvailabilityContext = {
  hasIdentity?: boolean
  dynamicTools?: Tool[]
}

export function getTool(name: string, context: ToolAvailabilityContext = {}): Tool | undefined {
  return [...(context.dynamicTools ?? []), ...BUILTIN_TOOLS].find(tool => tool.name === name)
}

export function toolsForMode(mode: SessionMode = 'chat', context: ToolAvailabilityContext = {}): Tool[] {
  const policy = modePolicy(mode)
  const allTools = [...BUILTIN_TOOLS, ...(context.dynamicTools ?? [])]
  return allTools.filter(tool => {
    if (mode === 'plan' && tool.kind === 'mcp' && tool.readOnly !== true) return false
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
