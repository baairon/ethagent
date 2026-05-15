import type { Provider } from '../providers/contracts.js'
import { getTool } from '../tools/registry.js'
import type { PendingToolUse } from './turnTypes.js'

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
  if (provider.id !== 'llamacpp') return []

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
