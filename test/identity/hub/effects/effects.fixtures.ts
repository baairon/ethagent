import { getAddress } from 'viem'
import type { Erc8004AgentCandidate, Erc8004RegistryConfig } from '../../../../src/identity/registry/erc8004.js'
import {
  createWalletRestoreAccessChallenge,
  createWalletRestoreAccessKey,
} from '../../../../src/identity/continuity/envelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../../../../src/identity/crypto/eth.js'

export const registry: Erc8004RegistryConfig = {
  chainId: 1,
  rpcUrl: 'https://example.com',
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
}

export const identityFixture = {
  source: 'erc8004' as const,
  address: '0x0000000000000000000000000000000000000A11',
  ownerAddress: '0x0000000000000000000000000000000000000A11',
  createdAt: new Date(0).toISOString(),
}

export function candidate(agentId: bigint, cid?: string): Erc8004AgentCandidate {
  return {
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    chainId: registry.chainId,
    rpcUrl: registry.rpcUrl,
    identityRegistryAddress: registry.identityRegistryAddress,
    agentId,
    agentUri: `ipfs://agent-${agentId.toString()}`,
    registration: null,
    ...(cid ? { backup: { cid, createdAt: new Date(0).toISOString() } } : {}),
  }
}

export const OWNER_WALLET = getAddress('0x000000000000000000000000000000000000C01D')
export const OPERATOR_WALLET = getAddress('0x000000000000000000000000000000000000B077')
export const RESTORE_KEY_FIXTURE = {
  address: OPERATOR_WALLET,
  challenge: 'restore-access-challenge',
  salt: 'AAAA',
  kemPublicKey: 'BBBB',
  createdAt: new Date(0).toISOString(),
}
export const OWNER_RESTORE_KEY_FIXTURE = {
  ...RESTORE_KEY_FIXTURE,
  address: OWNER_WALLET,
}

export const multiCustodyIdentity = {
  source: 'erc8004' as const,
  address: OWNER_WALLET,
  ownerAddress: OWNER_WALLET,
  createdAt: new Date(0).toISOString(),
  agentId: '45744',
  chainId: 8453,
  identityRegistryAddress: '0x0000000000000000000000000000000000000002' as `0x${string}`,
  state: {
    custodyMode: 'advanced',
    ownerAddress: OWNER_WALLET,
    activeOperatorAddress: OPERATOR_WALLET,
    approvedOperatorWallets: [{ address: OPERATOR_WALLET, restoreAccessKey: RESTORE_KEY_FIXTURE }],
    ownerRestoreAccessKey: OWNER_RESTORE_KEY_FIXTURE,
    restoreAccessEpoch: 10,
  },
}

export function buildEnvelopeFixtures() {
  const ownerKey = generatePrivateKey()
  const operatorKey = generatePrivateKey()
  const otherOperatorKey = generatePrivateKey()
  const ownerAddress = getAddress(addressFromPrivateKey(ownerKey))
  const operatorAddress = getAddress(addressFromPrivateKey(operatorKey))
  const otherOperatorAddress = getAddress(addressFromPrivateKey(otherOperatorKey))
  const token = {
    chainId: 1,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`,
    agentId: '42',
  }
  const accessEpoch = 3

  const ownerSaveChallenge = createWalletRestoreAccessChallenge({
    token,
    ownerAddress,
    walletAddress: ownerAddress,
    accessEpoch,
    purpose: 'update-snapshot',
  })
  const ownerSaveSignature = signMessage(ownerKey, ownerSaveChallenge)
  const ownerStoredKey = createWalletRestoreAccessKey({
    token,
    ownerAddress,
    walletAddress: ownerAddress,
    walletSignature: ownerSaveSignature,
    accessEpoch,
    purpose: 'update-snapshot',
  })

  const operatorOnboardChallenge = createWalletRestoreAccessChallenge({
    token,
    ownerAddress,
    walletAddress: operatorAddress,
    accessEpoch,
    purpose: 'operator-proof',
  })
  const operatorOnboardSignature = signMessage(operatorKey, operatorOnboardChallenge)
  const operatorStoredKey = createWalletRestoreAccessKey({
    token,
    ownerAddress,
    walletAddress: operatorAddress,
    walletSignature: operatorOnboardSignature,
    accessEpoch,
    purpose: 'operator-proof',
  })

  const otherOnboardChallenge = createWalletRestoreAccessChallenge({
    token,
    ownerAddress,
    walletAddress: otherOperatorAddress,
    accessEpoch,
    purpose: 'operator-proof',
  })
  const otherOnboardSignature = signMessage(otherOperatorKey, otherOnboardChallenge)
  const otherStoredKey = createWalletRestoreAccessKey({
    token,
    ownerAddress,
    walletAddress: otherOperatorAddress,
    walletSignature: otherOnboardSignature,
    accessEpoch,
    purpose: 'operator-proof',
  })

  const baseState: Record<string, unknown> = {
    name: 'agent',
    custodyMode: 'advanced',
    ownerAddress: ownerAddress,
    restoreAccessEpoch: accessEpoch,
    ownerRestoreAccessKey: ownerStoredKey,
    approvedOperatorWallets: [
      { address: operatorAddress, restoreAccessKey: operatorStoredKey },
      { address: otherOperatorAddress, restoreAccessKey: otherStoredKey },
    ],
  }

  return {
    token,
    accessEpoch,
    ownerKey,
    ownerAddress,
    operatorKey,
    operatorAddress,
    otherOperatorAddress,
    baseState,
  }
}

export const ENVELOPE_FILES = {
  'SOUL.md': '# soul\n',
  'MEMORY.md': '# memory\n',
}

export const ENVELOPE_REGISTRY: Erc8004RegistryConfig = {
  chainId: 1,
  rpcUrl: 'http://localhost:8545',
  identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
}
