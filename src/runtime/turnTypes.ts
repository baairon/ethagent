import type { Message, Provider, ProviderRetryStreamEvent } from '../providers/contracts.js'
import type { ToolResult } from '../tools/contracts.js'

export type ProviderTurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_end' }
  | ProviderRetryStreamEvent
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; stopReason?: TurnStopReason }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export type TurnStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown'

export type ContinuationNudgeReason =
  | 'continuation'
  | 'tool_capability'
  | 'tool_state_claim'
  | 'tool_protocol_fake'
  | 'tool_delegation'
  | 'tool_budget'
  | 'private_continuity_tool'
  | 'private_continuity_tool_repair'
  | 'write_file_repair'
  | 'reasoning_only'

export type TurnEvent =
  | { type: 'iteration_start'; index: number }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_end' }
  | ProviderRetryStreamEvent
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | {
      type: 'tool_use_stop'
      id: string
      name: string
      input: Record<string, unknown>
    }
  | { type: 'assistant_message_committed'; text: string }
  | {
      type: 'tool_executed'
      id: string
      name: string
      input: Record<string, unknown>
      result: ToolResult
      cwd: string
    }
  | { type: 'continuation_nudge'; attempt: number; reason: ContinuationNudgeReason }
  | { type: 'local_tool_recovery' }
  | { type: 'error'; message: string; discardAssistant?: boolean }
  | { type: 'cancelled' }
  | { type: 'done'; finishedNormally: boolean; stopReason?: TurnStopReason }

export type PendingToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ExecutedToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
  result: ToolResult
  cwd: string
}

export type ToolBatchRunner = (
  pendingToolUses: PendingToolUse[],
) => Promise<{ cancelled: boolean; completedTools: ExecutedToolUse[] }>

export type RebuildMessages = () => Message[] | Promise<Message[]>

export type RuntimeTurnParams = {
  provider: Provider
  signal: AbortSignal
  initialMessages: Message[]
  rebuildMessages: RebuildMessages
  runToolBatch: ToolBatchRunner
  maxContinuationNudges?: number
}
