import {
  unsupportedToolStateClaims,
  type ToolEvidence,
} from './toolClaimGuards.js'
import { parseLocalModelTextToolUses } from './textToolParser.js'
import { runProviderTurn } from './providerTurn.js'
import {
  MAX_CONTINUATION_NUDGES,
  MAX_TOOL_USES_PER_TURN,
  REASONING_ONLY_NUDGE_TEXT,
  TOOL_BUDGET_NUDGE_TEXT,
  TOOL_DELEGATION_NUDGE_TEXT,
  TOOL_PROTOCOL_FAKE_NUDGE_TEXT,
  TOOL_STATE_CLAIM_REPAIR_NUDGE_TEXT,
  looksLikeFakeToolProtocolText,
  looksLikeToolDelegationText,
  nextNudge,
  nextToolResultRepairNudge,
} from './turnNudges.js'
import type {
  PendingToolUse,
  RuntimeTurnParams,
  TurnEvent,
  TurnStopReason,
} from './turnTypes.js'

export { parseLocalModelTextToolUse, parseLocalModelTextToolUses } from './textToolParser.js'
export {
  MAX_CONTINUATION_NUDGES,
  MAX_TOOL_USES_PER_TURN,
  looksLikeContinuationIntent,
  looksLikeFakeToolProtocolText,
  looksLikePrivateContinuityWorkspaceCreationIntent,
  looksLikeToolCapabilityConfusion,
  looksLikeToolDelegationText,
  looksLikeToolStateClaimWithoutTool,
} from './turnNudges.js'
export type {
  ContinuationNudgeReason,
  ExecutedToolUse,
  PendingToolUse,
  RebuildMessages,
  RuntimeTurnParams,
  ToolBatchRunner,
  TurnEvent,
} from './turnTypes.js'
export async function* runRuntimeTurn(
  params: RuntimeTurnParams,
): AsyncGenerator<TurnEvent, void, void> {
  const {
    provider,
    signal,
    initialMessages,
    rebuildMessages,
    runToolBatch,
    maxContinuationNudges = MAX_CONTINUATION_NUDGES,
  } = params

  let workingMessages = initialMessages
  let continuationNudges = 0
  let iterationIndex = 0
  let priorIterationHadTools = false
  let cumulativeToolUseCount = 0
  const toolEvidenceThisTurn: ToolEvidence[] = []

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hadToolsLastRound = priorIterationHadTools
    priorIterationHadTools = false

    if (signal.aborted) {
      yield { type: 'cancelled' }
      yield doneEvent(false)
      return
    }

    yield { type: 'iteration_start', index: iterationIndex }
    iterationIndex += 1

    let assistantText = ''
    const pendingToolUses: PendingToolUse[] = []
    let errored = false
    let cancelled = false
    let thinkingSeen = false
    let stopReason: TurnStopReason = 'unknown'

    try {
      for await (const ev of runProviderTurn(provider, workingMessages, signal)) {
        if (ev.type === 'retry') {
          yield ev
        } else if (ev.type === 'text') {
          assistantText += ev.delta
          yield { type: 'text', delta: ev.delta }
        } else if (ev.type === 'thinking') {
          thinkingSeen = true
          yield { type: 'thinking', delta: ev.delta }
        } else if (ev.type === 'thinking_end') {
          yield { type: 'thinking_end' }
        } else if (ev.type === 'tool_use_start') {
          yield { type: 'tool_use_start', id: ev.id, name: ev.name }
        } else if (ev.type === 'tool_use_delta') {
          yield { type: 'tool_use_delta', id: ev.id, delta: ev.delta }
        } else if (ev.type === 'tool_use_stop') {
          pendingToolUses.push({ id: ev.id, name: ev.name, input: ev.input })
          yield {
            type: 'tool_use_stop',
            id: ev.id,
            name: ev.name,
            input: ev.input,
          }
        } else if (ev.type === 'error') {
          errored = true
          yield { type: 'error', message: ev.message }
          break
        } else if (ev.type === 'cancelled') {
          cancelled = true
          break
        } else if (ev.type === 'done') {
          stopReason = ev.stopReason ?? 'unknown'
          break
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        cancelled = true
      } else {
        errored = true
        yield { type: 'error', message: (err as Error).message || 'stream error' }
      }
    }

    if (signal.aborted || cancelled) {
      yield { type: 'cancelled' }
      yield doneEvent(false, stopReason)
      return
    }

    if (errored) {
      yield doneEvent(false, stopReason)
      return
    }

    if (pendingToolUses.length === 0) {
      const parsedToolUses = parseLocalModelTextToolUses(provider, assistantText, iterationIndex - 1)
      if (parsedToolUses.length > 0) {
        pendingToolUses.push(...parsedToolUses)
        yield { type: 'local_tool_recovery' }
        for (const parsedToolUse of parsedToolUses) {
          yield {
            type: 'tool_use_stop',
            id: parsedToolUse.id,
            name: parsedToolUse.name,
            input: parsedToolUse.input,
          }
        }
      }
    }

    if (pendingToolUses.length === 0 && provider.supportsTools && looksLikeFakeToolProtocolText(assistantText)) {
      if (continuationNudges < maxContinuationNudges) {
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: 'tool_protocol_fake',
        }
        workingMessages = [
          ...await rebuildMessages(),
          { role: 'user', content: TOOL_PROTOCOL_FAKE_NUDGE_TEXT },
        ]
        continue
      }
      yield {
        type: 'error',
        message: 'Model printed tool names instead of making a tool call',
        discardAssistant: true,
      }
      yield doneEvent(false, stopReason)
      return
    }

    if (pendingToolUses.length === 0 && provider.supportsTools && looksLikeToolDelegationText(assistantText)) {
      if (continuationNudges < maxContinuationNudges) {
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: 'tool_delegation',
        }
        workingMessages = [
          ...await rebuildMessages(),
          { role: 'user', content: TOOL_DELEGATION_NUDGE_TEXT },
        ]
        continue
      }
      yield {
        type: 'error',
        message: 'Model asked the user to run a tool instead of making a tool call',
        discardAssistant: true,
      }
      yield doneEvent(false, stopReason)
      return
    }

    if (pendingToolUses.length === 0) {
      const unsupportedClaims = unsupportedToolStateClaims(assistantText, toolEvidenceThisTurn)
      if (unsupportedClaims.length > 0) {
        if (continuationNudges < maxContinuationNudges) {
          continuationNudges += 1
          yield {
            type: 'continuation_nudge',
            attempt: continuationNudges,
            reason: 'tool_state_claim',
          }
          workingMessages = [
            ...await rebuildMessages(),
            {
              role: 'user',
              content:
                TOOL_STATE_CLAIM_REPAIR_NUDGE_TEXT,
            },
          ]
          continue
        }
        yield {
          type: 'error',
          message: 'Model claimed workspace state without matching tool evidence',
          discardAssistant: true,
        }
        yield doneEvent(false, stopReason)
        return
      }
    }

    if (pendingToolUses.length === 0) {
      if (!assistantText && thinkingSeen && continuationNudges < maxContinuationNudges) {
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: 'reasoning_only',
        }
        workingMessages = [
          ...await rebuildMessages(),
          { role: 'user', content: REASONING_ONLY_NUDGE_TEXT },
        ]
        continue
      }

      const nudge = nextNudge(provider, assistantText)
      if (assistantText && continuationNudges < maxContinuationNudges && nudge) {
        if (hadToolsLastRound && nudge.reason === 'continuation') {
          yield { type: 'assistant_message_committed', text: assistantText }
          yield doneEvent(true, stopReason)
          return
        }
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: nudge.reason,
        }
        workingMessages = [
          ...await rebuildMessages(),
          ...(nudge.keepAssistantContext ? [{ role: 'assistant' as const, content: assistantText }] : []),
          { role: 'user', content: nudge.text },
        ]
        continue
      }
      if (assistantText && nudge?.reason === 'tool_capability') {
        yield {
          type: 'error',
          message: 'Model refused available tools after corrective nudges',
        }
        yield doneEvent(false, stopReason)
        return
      }

      if (assistantText) {
        yield { type: 'assistant_message_committed', text: assistantText }
      }

      yield doneEvent(true, stopReason)
      return
    }

    if (cumulativeToolUseCount + pendingToolUses.length > MAX_TOOL_USES_PER_TURN) {
      if (continuationNudges < maxContinuationNudges) {
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: 'tool_budget',
        }
        workingMessages = [
          ...await rebuildMessages(),
          { role: 'user', content: TOOL_BUDGET_NUDGE_TEXT },
        ]
        continue
      }
      yield {
        type: 'error',
        message: `tool budget exceeded (${MAX_TOOL_USES_PER_TURN} max per turn); ask again with a narrower request`,
      }
      yield doneEvent(false, stopReason)
      return
    }
    cumulativeToolUseCount += pendingToolUses.length

    const batch = await runToolBatch(pendingToolUses)
    for (const completed of batch.completedTools) {
      toolEvidenceThisTurn.push({
        name: completed.name,
        result: { ok: completed.result.ok },
      })
    }

    for (const completed of batch.completedTools) {
      yield {
        type: 'tool_executed',
        id: completed.id,
        name: completed.name,
        input: completed.input,
        result: completed.result,
        cwd: completed.cwd,
      }
    }

    if (batch.cancelled || signal.aborted) {
      yield { type: 'cancelled' }
      yield doneEvent(false, stopReason)
      return
    }

    const repairNudge = nextToolResultRepairNudge(provider, batch.completedTools)
    if (repairNudge) {
      if (continuationNudges < maxContinuationNudges) {
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: repairNudge.reason,
        }
        workingMessages = [
          ...await rebuildMessages(),
          { role: 'user', content: repairNudge.text },
        ]
        continue
      }
      yield {
        type: 'error',
        message: repairNudge.failureMessage,
        discardAssistant: true,
      }
      yield doneEvent(false, stopReason)
      return
    }

    priorIterationHadTools = true
    workingMessages = await rebuildMessages()
  }
}

function doneEvent(finishedNormally: boolean, stopReason?: TurnStopReason): Extract<TurnEvent, { type: 'done' }> {
  if (stopReason && stopReason !== 'end_turn' && stopReason !== 'unknown') {
    return { type: 'done', finishedNormally, stopReason }
  }
  return { type: 'done', finishedNormally }
}
