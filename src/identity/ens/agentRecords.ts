export const AGENT_RECORD_KEYS = {
  token:   'org.ethagent.token',
  profile: 'org.ethagent.profile',
} as const

type AgentRecordKey = typeof AGENT_RECORD_KEYS[keyof typeof AGENT_RECORD_KEYS]

export const AGENT_RECORD_KEY_LIST: readonly AgentRecordKey[] = [
  AGENT_RECORD_KEYS.token,
  AGENT_RECORD_KEYS.profile,
] as const

export const AGENT_RECORD_READ_KEY_LIST: readonly string[] = AGENT_RECORD_KEY_LIST

export type AgentEnsRecords = {
  token?: string
  profile?: string
}

export type AgentEnsRecordState = AgentEnsRecords

export type AgentRecordDiff = {
  key: AgentRecordKey
  field: keyof AgentEnsRecordState
  current: string
  next: string
  changed: boolean
}

const FIELD_FOR_KEY: Record<AgentRecordKey, keyof AgentEnsRecords> = {
  [AGENT_RECORD_KEYS.token]:   'token',
  [AGENT_RECORD_KEYS.profile]: 'profile',
}

const LABEL_FOR_FIELD: Record<keyof AgentEnsRecordState, string> = {
  token:   'Agent token',
  profile: 'Agent profile',
}

export function recordsFromTextMap(text: Record<string, string>): AgentEnsRecordState {
  return {
    token:   text[AGENT_RECORD_KEYS.token]   ?? '',
    profile: text[AGENT_RECORD_KEYS.profile] ?? '',
  }
}

export function diffRecords(current: AgentEnsRecordState, next: AgentEnsRecords): AgentRecordDiff[] {
  return AGENT_RECORD_KEY_LIST.map(key => {
    const field = FIELD_FOR_KEY[key]
    const currentValue = (current[field] ?? '').trim()
    const nextValue = (next[field] ?? '').trim()
    return {
      key,
      field,
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

export function recordLabel(field: keyof AgentEnsRecordState): string {
  return LABEL_FOR_FIELD[field]
}

export function formatRecordValue(field: keyof AgentEnsRecordState, value: string): string {
  if (field === 'profile' && value.startsWith('ipfs://')) {
    const cid = value.slice('ipfs://'.length)
    return cid.length > 18 ? `ipfs://${cid.slice(0, 10)}...${cid.slice(-6)}` : value
  }
  return value
}

export function buildAgentEnsRecords(args: {
  chainId: number
  identityRegistryAddress: string
  agentId: string | undefined
  agentCardCid: string | undefined
}): AgentEnsRecords {
  const records: AgentEnsRecords = {}
  if (args.agentId) {
    records.token = `eip155:${args.chainId}:${args.identityRegistryAddress.toLowerCase()}:${args.agentId}`
  }
  if (args.agentCardCid) {
    records.profile = `ipfs://${args.agentCardCid}`
  }
  return records
}
