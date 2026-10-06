import { catFromIpfs, DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import { createAdaptiveFetch } from '../../../net/adaptive.js'
import type { FetchLike } from './types.js'
import { decodeDataUri, parseJsonObject } from './utils.js'

export async function loadAgentRegistration(
  uri: string,
  args: { ipfsApiUrl?: string; fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<{ metadataCid?: string; registration: Record<string, unknown> }> {
  const trimmed = uri.trim()
  let raw: string
  if (trimmed.startsWith('ipfs://')) {
    const cid = cidFromUri(trimmed)
    if (!cid) throw new Error('AgentURI is missing an IPFS CID')
    raw = new TextDecoder().decode(await catFromIpfs(
      args.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
      cid,
      args.fetchImpl ?? fetch,
      args.signal ? { signal: args.signal } : {},
    ))
    return { metadataCid: cid, registration: parseJsonObject(raw) }
  }
  if (trimmed.startsWith('data:')) {
    return { registration: parseJsonObject(decodeDataUri(trimmed)) }
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const response = await createAdaptiveFetch(args.fetchImpl)(trimmed, args.signal ? { signal: args.signal } : {})
    if (!response.ok) throw new Error('agent token URI fetch failed: ' + response.status + ' ' + response.statusText)
    return { registration: parseJsonObject(await response.text()) }
  }
  throw new Error('Unsupported agentURI scheme')
}

export function cidFromUri(uri: string): string | undefined {
  if (!uri.startsWith('ipfs://')) return undefined
  const withoutScheme = uri.slice('ipfs://'.length)
  return withoutScheme.startsWith('ipfs/') ? withoutScheme.slice('ipfs/'.length) : withoutScheme
}
