import type { Address } from 'viem'
import { encodeInteroperableAddress } from './erc7930.js'

export const AGENT_TOKEN_RECORD_KEY = 'org.ethagent.token'

export type AgentEnsRecords = Record<string, string>
export type AgentEnsRecordState = Record<string, string>

export type AgentRecordDiff = {
  key: string
  current: string
  next: string
  changed: boolean
}

export type Ensip25KeyArgs = {
  chainId: number
  identityRegistryAddress: Address | string
  agentId: string | bigint
}

export function buildEnsip25Key(args: Ensip25KeyArgs): string {
  const agentIdStr = typeof args.agentId === 'bigint' ? args.agentId.toString() : args.agentId.trim()
  if (!agentIdStr) throw new Error('agentId is required to build the ENSIP-25 record key')
  if (agentIdStr.includes('[') || agentIdStr.includes(']')) {
    throw new Error('agentId must not contain square brackets per ENSIP-25')
  }
  const registry = encodeInteroperableAddress({
    chainId: args.chainId,
    address: args.identityRegistryAddress as Address,
  })
  return `agent-registration[${registry}][${agentIdStr}]`
}

export function buildAgentTokenReferenceValue(args: Ensip25KeyArgs): string {
  const agentIdStr = typeof args.agentId === 'bigint' ? args.agentId.toString() : args.agentId.trim()
  return `eip155:${args.chainId}:${(args.identityRegistryAddress as string).toLowerCase()}:${agentIdStr}`
}

export function buildAgentEnsRecords(args: {
  chainId: number
  identityRegistryAddress: Address | string
  agentId: string | bigint | undefined
}): AgentEnsRecords {
  if (args.agentId === undefined || args.agentId === '') return {}
  const ensip25Key = buildEnsip25Key({
    chainId: args.chainId,
    identityRegistryAddress: args.identityRegistryAddress,
    agentId: args.agentId,
  })
  const tokenValue = buildAgentTokenReferenceValue({
    chainId: args.chainId,
    identityRegistryAddress: args.identityRegistryAddress,
    agentId: args.agentId,
  })
  return {
    [ensip25Key]: '1',
    [AGENT_TOKEN_RECORD_KEY]: tokenValue,
  }
}

export function recordsFromTextMap(text: Record<string, string>): AgentEnsRecordState {
  const out: AgentEnsRecordState = {}
  for (const [key, value] of Object.entries(text)) {
    if (value) out[key] = value
  }
  return out
}

export function diffRecords(current: AgentEnsRecordState, next: AgentEnsRecords): AgentRecordDiff[] {
  const keys = new Set<string>([...Object.keys(current), ...Object.keys(next)])
  return Array.from(keys).map(key => {
    const currentValue = (current[key] ?? '').trim()
    const nextValue = (next[key] ?? '').trim()
    return {
      key,
      current: currentValue,
      next: nextValue,
      changed: currentValue !== nextValue,
    }
  })
}

export function changedRecords(current: AgentEnsRecordState, next: AgentEnsRecords): Record<string, string> {
  const out: Record<string, string> = {}
  for (const diff of diffRecords(current, next)) {
    if (diff.changed) out[diff.key] = diff.next
  }
  return out
}

export function clearedRecords(current: AgentEnsRecordState): AgentEnsRecords {
  const out: AgentEnsRecords = {}
  for (const key of Object.keys(current)) {
    out[key] = ''
  }
  return out
}
