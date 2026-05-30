import type { EthagentConfig } from '../storage/config.js'
import type { AgentReconciliation } from '../identity/manager/shared/reconciliation/index.js'

const DEMO_ENV = 'ETHAGENT_DEMO'

export function isDemoMode(): boolean {
  return process.env[DEMO_ENV] === '1'
}

export function enableDemoMode(): void {
  process.env[DEMO_ENV] = '1'
}

const DEMO_OWNER = '0xA1E977e700bF82019beb381F1582575303A389CE' as const
const DEMO_AGENT_ADDRESS = '0x6bdC52c8e262c6D139e618260400614c2Bfe51d7' as const
const DEMO_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const
const DEMO_AGENT_ID = '42'
const DEMO_AGENT_URI = 'ipfs://bafkreidemodemodemodemodemodemodemodemodemodemodemo'
const DEMO_BACKUP_CID = 'bafkreidemodemodemodemodemodemodemodemodemodemodemo'
const DEMO_AGENT_CARD_CID = 'bafkreidemoagentcarddemoagentcarddemoagentcarddemoag'
const DEMO_CREATED_AT = '2026-01-01T00:00:00.000Z'

export function synthDemoConfig(): EthagentConfig {
  return {
    version: 2,
    firstSeenAt: DEMO_CREATED_AT,
    selectedNetwork: 'base',
    erc8004: {
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      identityRegistryAddress: DEMO_REGISTRY,
    },
    identity: {
      source: 'erc8004',
      address: DEMO_AGENT_ADDRESS,
      ownerAddress: DEMO_OWNER,
      connectedWallet: DEMO_OWNER,
      createdAt: DEMO_CREATED_AT,
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      identityRegistryAddress: DEMO_REGISTRY,
      agentId: DEMO_AGENT_ID,
      agentUri: DEMO_AGENT_URI,
      metadataCid: DEMO_AGENT_URI.replace('ipfs://', ''),
      state: { name: 'demo agent', custodyMode: 'simple' },
      backup: {
        cid: DEMO_BACKUP_CID,
        createdAt: DEMO_CREATED_AT,
        envelopeVersion: 'ethagent-continuity-snapshot-v1',
        ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
        status: 'pinned',
        ownerAddress: DEMO_OWNER,
        chainId: 8453,
        rpcUrl: 'https://mainnet.base.org',
        identityRegistryAddress: DEMO_REGISTRY,
        agentId: DEMO_AGENT_ID,
        agentUri: DEMO_AGENT_URI,
        metadataCid: DEMO_AGENT_URI.replace('ipfs://', ''),
      },
      agentCard: {
        cid: DEMO_AGENT_CARD_CID,
        updatedAt: DEMO_CREATED_AT,
        status: 'pinned',
      },
    },
  }
}

export function synthDemoReconciliation(): AgentReconciliation {
  return {
    token: 'linked',
    tokenAgentId: DEMO_AGENT_ID,
    onChainOwner: DEMO_OWNER,
    custody: 'simple',
    agentUri: 'in-sync',
    vault: 'unset',
    workingTree: 'clean',
    rpc: 'reachable',
    driftCount: 0,
    lastCheckedAt: new Date().toISOString(),
  }
}

export function demoNotice(label: string): string {
  return `demo mode: would have ${label}`
}
