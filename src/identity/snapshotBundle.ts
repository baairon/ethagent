import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir, type EthagentIdentity } from '../storage/config.js'
import {
  AGENT_STATE_BACKUP_ENVELOPE_VERSION,
  parseAgentStateBackupEnvelope,
  serializeAgentStateBackupEnvelope,
  type AgentStateBackupEnvelope,
} from './backupEnvelope.js'
import { shortAddress } from './identityHubModel.js'

export const AGENT_SNAPSHOT_EXPORT_VERSION = 'ethagent-agent-export-v1'

export type AgentSnapshotExportBundle = {
  version: typeof AGENT_SNAPSHOT_EXPORT_VERSION
  exportedAt: string
  ownerAddress: string
  stateCid: string
  ipfsApiUrl: string
  chainId?: number
  rpcUrl?: string
  identityRegistryAddress?: string
  agentId?: string
  agentUri?: string
  metadataCid?: string
  envelope: AgentStateBackupEnvelope
}

export function createAgentSnapshotExportBundle(args: {
  identity: EthagentIdentity
  envelope: AgentStateBackupEnvelope
  exportedAt?: string
}): AgentSnapshotExportBundle {
  const backup = args.identity.backup
  if (!backup?.cid) throw new Error('no encrypted snapshot CID to export')
  if (!backup.ipfsApiUrl) throw new Error('snapshot storage endpoint is missing')
  const ownerAddress = args.identity.ownerAddress ?? args.identity.address
  if (!ownerAddress) throw new Error('snapshot owner is missing')
  if (args.envelope.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error('snapshot envelope owner does not match this identity')
  }
  return {
    version: AGENT_SNAPSHOT_EXPORT_VERSION,
    exportedAt: args.exportedAt ?? new Date().toISOString(),
    ownerAddress: args.envelope.ownerAddress,
    stateCid: backup.cid,
    ipfsApiUrl: backup.ipfsApiUrl,
    ...(args.identity.chainId ? { chainId: args.identity.chainId } : {}),
    ...(args.identity.rpcUrl ? { rpcUrl: args.identity.rpcUrl } : {}),
    ...(args.identity.identityRegistryAddress ? { identityRegistryAddress: args.identity.identityRegistryAddress } : {}),
    ...(args.identity.agentId ? { agentId: args.identity.agentId } : {}),
    ...(args.identity.agentUri ? { agentUri: args.identity.agentUri } : {}),
    ...(args.identity.metadataCid ? { metadataCid: args.identity.metadataCid } : {}),
    envelope: args.envelope,
  }
}

export function serializeAgentSnapshotExportBundle(bundle: AgentSnapshotExportBundle): string {
  const normalized = parseAgentSnapshotExportBundle(JSON.stringify(bundle))
  return JSON.stringify(normalized, null, 2)
}

export function parseAgentSnapshotExportBundle(raw: string | Uint8Array): AgentSnapshotExportBundle {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid encrypted snapshot export')
  const obj = parsed as Partial<AgentSnapshotExportBundle>
  if (obj.version !== AGENT_SNAPSHOT_EXPORT_VERSION) throw new Error('unsupported encrypted snapshot export version')
  if (typeof obj.exportedAt !== 'string') throw new Error('encrypted snapshot export is missing exportedAt')
  if (typeof obj.ownerAddress !== 'string') throw new Error('encrypted snapshot export is missing owner')
  if (typeof obj.stateCid !== 'string' || !obj.stateCid.trim()) throw new Error('encrypted snapshot export is missing state CID')
  if (typeof obj.ipfsApiUrl !== 'string' || !obj.ipfsApiUrl.trim()) throw new Error('encrypted snapshot export is missing storage endpoint')
  if (!obj.envelope) throw new Error('encrypted snapshot export is missing envelope')
  const envelope = parseAgentStateBackupEnvelope(JSON.stringify(obj.envelope))
  if (envelope.envelopeVersion !== AGENT_STATE_BACKUP_ENVELOPE_VERSION) {
    throw new Error('unsupported agent state backup envelope version')
  }
  if (envelope.ownerAddress.toLowerCase() !== obj.ownerAddress.toLowerCase()) {
    throw new Error('encrypted snapshot owner does not match envelope owner')
  }
  return {
    version: AGENT_SNAPSHOT_EXPORT_VERSION,
    exportedAt: obj.exportedAt,
    ownerAddress: envelope.ownerAddress,
    stateCid: obj.stateCid,
    ipfsApiUrl: obj.ipfsApiUrl,
    ...(typeof obj.chainId === 'number' ? { chainId: obj.chainId } : {}),
    ...(typeof obj.rpcUrl === 'string' ? { rpcUrl: obj.rpcUrl } : {}),
    ...(typeof obj.identityRegistryAddress === 'string' ? { identityRegistryAddress: obj.identityRegistryAddress } : {}),
    ...(typeof obj.agentId === 'string' ? { agentId: obj.agentId } : {}),
    ...(typeof obj.agentUri === 'string' ? { agentUri: obj.agentUri } : {}),
    ...(typeof obj.metadataCid === 'string' ? { metadataCid: obj.metadataCid } : {}),
    envelope,
  }
}

export function getAgentSnapshotExportsDir(): string {
  return path.join(getConfigDir(), 'exports')
}

export async function writeAgentSnapshotExportBundle(bundle: AgentSnapshotExportBundle): Promise<string> {
  await fs.mkdir(getAgentSnapshotExportsDir(), { recursive: true })
  const token = bundle.agentId ? `agent-${bundle.agentId}` : shortAddress(bundle.ownerAddress).replaceAll('.', '')
  const stamp = bundle.exportedAt.replace(/[:.]/g, '-')
  const file = path.join(getAgentSnapshotExportsDir(), `${token}-${stamp}.json`)
  await fs.writeFile(file, serializeAgentSnapshotExportBundle(bundle), { mode: 0o600 })
  return file
}

export async function readAgentSnapshotExportBundle(source: string, cwd = process.cwd()): Promise<AgentSnapshotExportBundle> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('encrypted snapshot export is empty')
  if (trimmed.startsWith('{')) return parseAgentSnapshotExportBundle(trimmed)
  const resolved = path.resolve(cwd, trimmed)
  const raw = await fs.readFile(resolved, 'utf8')
  return parseAgentSnapshotExportBundle(raw)
}

export function encryptedEnvelopeText(bundle: AgentSnapshotExportBundle): string {
  return serializeAgentStateBackupEnvelope(bundle.envelope)
}
