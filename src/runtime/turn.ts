import type { Message, Provider, StreamEvent } from '../providers/contracts.js'
import type { ToolResult } from '../tools/contracts.js'
import { getTool } from '../tools/registry.js'
import {
  looksLikeToolStateClaim,
  unsupportedToolStateClaims,
  type ToolEvidence,
} from './toolClaimGuards.js'

type ProviderTurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

async function* runProviderTurn(
  provider: Provider,
  messages: Message[],
  signal: AbortSignal,
): AsyncIterable<ProviderTurnEvent> {
  if (signal.aborted) {
    yield { type: 'cancelled' }
    return
  }
  for await (const ev of provider.complete(messages, signal)) {
    if (signal.aborted) {
      yield { type: 'cancelled' }
      return
    }
    yield normalize(ev)
    if (ev.type === 'done' || ev.type === 'error') return
  }
  if (signal.aborted) {
    yield { type: 'cancelled' }
  }
}

function normalize(event: StreamEvent): ProviderTurnEvent {
  switch (event.type) {
    case 'text': return { type: 'text', delta: event.delta }
    case 'thinking': return { type: 'thinking', delta: event.delta }
    case 'tool_use_start': return event
    case 'tool_use_delta': return event
    case 'tool_use_stop': return event
    case 'done': return { type: 'done' }
    case 'error': return { type: 'error', message: event.message }
  }
}

/**
 * MAX_CONTINUATION_NUDGES: if the model stops a turn without emitting any
 * tool_use AND the last assistant text signals intent to continue (e.g.
 * "now I'll..."), we re-invoke the provider up to this many times with a
 * small meta nudge appended. Ported from openclaude/src/query.ts:163.
 */
export const MAX_CONTINUATION_NUDGES = 3

export type ContinuationNudgeReason =
  | 'continuation'
  | 'tool_capability'
  | 'tool_state_claim'

const CONTINUATION_NUDGE_TEXT =
  'Continue with the task. Use the appropriate tools to proceed.'

const TOOL_CAPABILITY_NUDGE_TEXT =
  'You do have access to the provided tools in this environment. Continue by making the appropriate tool call; do not ask the user to run commands or paste command output.'

const TOOL_STATE_CLAIM_NUDGE_TEXT =
  'Do not claim that files, directories, or workspace state changed unless you have executed the appropriate tool. Call the tool now.'

/**
 * TurnEvent — events emitted by the runtime turn loop. The UI layer subscribes
 * and translates these into Ink rows, notes, permission prompts, and session
 * writes. Modeled after openclaude's event shape but trimmed to what ethagent
 * actually uses.
 */
export type TurnEvent =
  | { type: 'iteration_start'; index: number }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
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
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
  | { type: 'done'; finishedNormally: boolean }

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

/**
 * The runtime loop needs a way to hand pending tool_uses to the host (the UI
 * adapter) so the host can:
 *   - render tool_use / tool_result rows,
 *   - persist tool_use / tool_result session messages,
 *   - route permission prompts,
 *   - and detect cancellation mid-execution.
 *
 * The host returns what actually happened so the loop can feed tool_results
 * back to the provider for the next iteration.
 */
export type ToolBatchRunner = (
  pendingToolUses: PendingToolUse[],
) => Promise<{ cancelled: boolean; completedTools: ExecutedToolUse[] }>

/**
 * rebuildWorkingMessages: after every tool batch, the host recomputes the
 * Message[] it wants to send to the provider. This keeps microcompact,
 * system-prompt composition, and file-mention context completely outside the
 * loop — the loop only cares about "give me the next prompt window".
 */
export type RebuildMessages = () => Message[]

export type RuntimeTurnParams = {
  provider: Provider
  signal: AbortSignal
  /** Initial Message[] to send. */
  initialMessages: Message[]
  /**
   * Called after every tool execution round to rebuild the Message[] for the
   * next provider call. The host is responsible for microcompact, system
   * prompt, and any mention context — the loop is deliberately dumb here.
   */
  rebuildMessages: RebuildMessages
  runToolBatch: ToolBatchRunner
  /** Upper bound on continuation nudges per turn. Defaults to MAX_CONTINUATION_NUDGES. */
  maxContinuationNudges?: number
}

/**
 * runRuntimeTurn — the one and only turn loop.
 *
 * Shape (ported from openclaude/src/query.ts:244):
 *   1. Stream the provider.
 *   2. Collect tool_use blocks from native `tool_use_stop` events.
 *   3. If the model emitted tool_uses: execute them, feed results back, loop.
 *   4. If it didn't: check if the last assistant text signals intent to
 *      continue ("now I'll..."). If yes and we're under the cap, append a
 *      soft meta nudge and loop. Otherwise exit.
 *
 * Intentionally absent:
 *   - No provider-family branching (no isLocalProvider specialization).
 *   - No broad regex fallback tool parsing. A narrow Ollama/Qwen
 *     compatibility parser handles standalone JSON tool payloads only.
 *   - No duplicate-tool-call suppression. The model is allowed to repeat.
 *   - No forced-repair retries on tool input validation errors — errors go
 *     back to the model as tool_result(is_error) and the model decides.
 */
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
  const toolEvidenceThisTurn: ToolEvidence[] = []

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) {
      yield { type: 'cancelled' }
      yield { type: 'done', finishedNormally: false }
      return
    }

    yield { type: 'iteration_start', index: iterationIndex }
    iterationIndex += 1

    let assistantText = ''
    const pendingToolUses: PendingToolUse[] = []
    let errored = false
    let cancelled = false

    try {
      for await (const ev of runProviderTurn(provider, workingMessages, signal)) {
        if (ev.type === 'text') {
          assistantText += ev.delta
          yield { type: 'text', delta: ev.delta }
        } else if (ev.type === 'thinking') {
          yield { type: 'thinking', delta: ev.delta }
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
      yield { type: 'done', finishedNormally: false }
      return
    }

    if (errored) {
      yield { type: 'done', finishedNormally: false }
      return
    }

    if (pendingToolUses.length === 0) {
      const parsedToolUses = parseLocalModelTextToolUses(provider, assistantText, iterationIndex - 1)
      if (parsedToolUses.length > 0) {
        pendingToolUses.push(...parsedToolUses)
        // Signal the orchestrator to discard any streamed assistant text
        // rows that contained the JSON blob — they should not be persisted.
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
          // Rebuild from scratch, inject a correction context message to
          // demote prior unsupported assistant claims, then append the nudge.
          // This prevents the model from reinforcing its own false claims
          // on subsequent iterations within the same turn.
          workingMessages = [
            ...rebuildMessages(),
            {
              role: 'user',
              content:
                'The previous assistant response claimed workspace state without executing a tool. '
                + 'Treat that claim as unreliable. '
                + TOOL_STATE_CLAIM_NUDGE_TEXT,
            },
          ]
          continue
        }
        yield {
          type: 'error',
          message: 'model claimed workspace state without matching tool evidence',
        }
        yield { type: 'done', finishedNormally: false }
        return
      }
    }

    // No tool work: model decided this turn is over (modulo continuation nudge).
    if (pendingToolUses.length === 0) {
      const nudge = nextNudge(provider, assistantText)
      if (assistantText && continuationNudges < maxContinuationNudges && nudge) {
        continuationNudges += 1
        yield {
          type: 'continuation_nudge',
          attempt: continuationNudges,
          reason: nudge.reason,
        }
        workingMessages = [
          ...rebuildMessages(),
          ...(nudge.keepAssistantContext ? [{ role: 'assistant' as const, content: assistantText }] : []),
          { role: 'user', content: nudge.text },
        ]
        continue
      }
      if (assistantText && nudge?.reason === 'tool_capability') {
        yield {
          type: 'error',
          message: 'model refused available tools after corrective nudges',
        }
        yield { type: 'done', finishedNormally: false }
        return
      }

      if (assistantText) {
        yield { type: 'assistant_message_committed', text: assistantText }
      }

      yield { type: 'done', finishedNormally: true }
      return
    }

    // Tool work: hand the batch to the host. The host renders rows, persists
    // the tool_use/tool_result session messages, and routes permission prompts.
    // We then emit tool_executed events so UI adapters that care (e.g., tests)
    // can observe each completed tool before we loop back to the provider.
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
      yield { type: 'done', finishedNormally: false }
      return
    }

    workingMessages = rebuildMessages()
  }
}

export function parseLocalModelTextToolUse(
  provider: Pick<Provider, 'id'>,
  assistantText: string,
  iterationIndex = 0,
): PendingToolUse | null {
  const parsed = parseLocalModelTextToolUses(provider, assistantText, iterationIndex)
  return parsed.length === 1 ? parsed[0]! : null
}

export function parseLocalModelTextToolUses(
  provider: Pick<Provider, 'id'>,
  assistantText: string,
  iterationIndex = 0,
): PendingToolUse[] {
  if (provider.id !== 'ollama') return []

  const calls = extractTextToolCalls(assistantText)
  if (calls.length === 0) return []

  return calls.map((call, index) => ({
    id: calls.length === 1 ? `local-text-tool-${iterationIndex}` : `local-text-tool-${iterationIndex}-${index}`,
    name: call.name,
    input: call.input,
  }))
}

function extractTextToolCalls(text: string): Array<{ name: string; input: Record<string, unknown> }> {
  const payloads = extractToolPayloadCandidates(text)
  const calls = payloads.flatMap(parseTextToolPayloads)
  return calls.filter(call => typeof call.name === 'string' && isRecord(call.input) && Boolean(getTool(call.name)))
}

function extractToolPayloadCandidates(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const exact = normalizeToolPayloadCandidate(trimmed)
  if (exact.startsWith('{') && exact.endsWith('}')) return [exact]
  if (exact.startsWith('[') && exact.endsWith(']')) return [exact]

  const fencedOnlyMatch = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/i)
  if (fencedOnlyMatch) return [normalizeToolPayloadCandidate(fencedOnlyMatch[1]!)]

  const embedded = [
    ...[...trimmed.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)].map(match => match[1]!),
    ...[...trimmed.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g)].map(match => match[1]!),
    ...extractStandaloneJsonPayloads(trimmed),
  ].map(normalizeToolPayloadCandidate)

  return [...new Set(embedded)]
}

function extractStandaloneJsonPayloads(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const first = normalizeToolPayloadCandidate(line)
    if (!first.startsWith('{') && !first.startsWith('[')) continue

    let candidate = line
    for (let j = i; j < lines.length; j += 1) {
      if (j > i) candidate += `\n${lines[j] ?? ''}`
      const normalized = normalizeToolPayloadCandidate(candidate)
      if (canParseJson(normalized)) {
        out.push(normalized)
        i = j
        break
      }
      if (candidate.length > 20_000) break
    }
  }

  return out
}

function canParseJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function normalizeToolPayloadCandidate(candidate: string): string {
  let normalized = candidate
    .trim()
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\d+\s+(?=[{\[<"])/, ''))
    .join('\n')
    .trim()

  const toolCallMatch = normalized.match(/^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/i)
  if (toolCallMatch) normalized = toolCallMatch[1]!.trim()
  return normalized
}

function parseTextToolPayloads(payload: string): Array<{ name: string; input: Record<string, unknown> }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return []
  }

  return normalizeParsedToolPayloads(parsed)
}

function parseTextToolPayload(payload: string): { name: string; input: Record<string, unknown> } | null {
  const calls = parseTextToolPayloads(payload)
  return calls.length === 1 ? calls[0]! : null
}

function normalizeParsedToolPayloads(value: unknown): Array<{ name: string; input: Record<string, unknown> }> {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeParsedToolPayloads)
  }
  if (!isRecord(value)) return []

  const toolCalls = value.tool_calls
  if (Array.isArray(toolCalls)) {
    return toolCalls.flatMap(normalizeParsedToolPayloads)
  }

  const fn = value.function
  if (isRecord(fn)) {
    const call = normalizeNameAndInput(fn.name, fn.arguments)
    return call ? [call] : []
  }

  const name = value.name ?? value.tool ?? value.tool_name ?? value.function_name
  const rawInput = value.arguments ?? value.input ?? value.parameters ?? value.args ?? {}
  const call = normalizeNameAndInput(name, rawInput)
  return call ? [call] : []
}

function normalizeParsedToolPayload(value: unknown): { name: string; input: Record<string, unknown> } | null {
  const calls = normalizeParsedToolPayloads(value)
  return calls.length === 1 ? calls[0]! : null
}

function normalizeNameAndInput(
  name: unknown,
  rawInput: unknown,
): { name: string; input: Record<string, unknown> } | null {
  if (typeof name !== 'string') return null
  const input = parseToolInput(rawInput)
  if (!input) return null
  return { name, input }
}

function parseToolInput(rawInput: unknown): Record<string, unknown> | null {
  if (isRecord(rawInput)) return rawInput
  if (typeof rawInput !== 'string') return null
  try {
    const parsed = JSON.parse(rawInput)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nextNudge(
  provider: Pick<Provider, 'supportsTools'>,
  assistantText: string,
): { text: string; reason: ContinuationNudgeReason; keepAssistantContext: boolean } | null {
  if (provider.supportsTools && looksLikeToolCapabilityConfusion(assistantText)) {
    return {
      text: TOOL_CAPABILITY_NUDGE_TEXT,
      reason: 'tool_capability',
      keepAssistantContext: false,
    }
  }
  if (looksLikeContinuationIntent(assistantText)) {
    return {
      text: CONTINUATION_NUDGE_TEXT,
      reason: 'continuation',
      keepAssistantContext: true,
    }
  }
  return null
}

export function looksLikeToolCapabilityConfusion(text: string): boolean {
  const lower = text.toLowerCase()
  const limitation =
    /\b(i (do not|don't|cannot|can't) (have|access|run|execute|inspect|read|list|use)|no direct access|unable to|not able to|currently operating under|limitations and restrictions)\b/
  const toolTask =
    /\b(run|execute|shell command|command output|local machine|terminal|files?|directories|workspace|paste|share the contents)\b/
  return limitation.test(lower) && toolTask.test(lower)
}

export function looksLikeToolStateClaimWithoutTool(text: string): boolean {
  return looksLikeToolStateClaim(text)
}

/**
 * looksLikeContinuationIntent — heuristic port of openclaude's continuation
 * nudge detection (query.ts:1394-1463).
 *
 * Two rules:
 *   1. If the text contains an explicit completion marker ("done", "all set",
 *      "let me know if"), never nudge.
 *   2. Otherwise, nudge iff at least one action-intent pattern matches
 *      ("now I'll edit", "let me create", "time to run", etc.).
 *
 * Deliberately narrow. We never rewrite the model's output; we only decide
 * whether to append a short meta user message and re-stream.
 */
export function looksLikeContinuationIntent(text: string): boolean {
  const lower = text.toLowerCase()

  const completionMarkers =
    /\b(done|finished|completed|complete|summary|that's all|that is all|all set|hope this helps|let me know if)\b/
  if (completionMarkers.test(lower)) return false

  const actionVerbs =
    '(do|create|write|edit|update|fix|implement|add|run|check|make|build|set up|go|proceed|begin)'

  const shortMessage = lower.length < 80

  const patterns: RegExp[] = [
    new RegExp(
      `\\bso now (i|let me|we) (need to|have to|should|must|will) ${actionVerbs}\\b`,
    ),
    new RegExp(`\\bnow i('ll| will) ${actionVerbs}\\b`),
    new RegExp(
      `\\blet me (go ahead and |now )?${actionVerbs}\\b`,
    ),
    new RegExp(`\\btime to ${actionVerbs}\\b`),
  ]

  if (shortMessage) {
    patterns.push(
      new RegExp(
        `\\bi('ll| will| need to| have to| must) (now )?${actionVerbs}\\b`,
      ),
      new RegExp(
        `\\bnext,?\\s+(i('ll| will)|let me|i need to) ${actionVerbs}\\b`,
      ),
    )
  }

  return patterns.some(re => re.test(lower))
}
