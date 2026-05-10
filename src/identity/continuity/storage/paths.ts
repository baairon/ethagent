import path from 'node:path'
import { getConfigDir, type EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityVaultRef } from './types.js'

export function continuityVaultRef(identity: Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'agentId' | 'address'>): ContinuityVaultRef {
  const dir = path.join(getConfigDir(), 'continuity', continuityVaultId(identity))
  return {
    dir,
    soulPath: path.join(dir, 'SOUL.md'),
    memoryPath: path.join(dir, 'MEMORY.md'),
    publicSkillsPath: path.join(dir, 'skills.json'),
  }
}

function continuityVaultId(identity: Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'agentId' | 'address'>): string {
  const chain = identity.chainId?.toString() ?? 'unknown-chain'
  const registry = sanitizePathPart(identity.identityRegistryAddress ?? 'unknown-registry')
  const token = sanitizePathPart(identity.agentId ?? identity.address)
  return `${chain}-${registry}-${token}`
}

function sanitizePathPart(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '').replace(/[^a-z0-9._-]+/g, '-').slice(0, 120) || 'unknown'
}
