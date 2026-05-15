import { getAddress, isAddress, type Address } from 'viem'
import type { TransferSnapshotMetadata } from '../../../storage/config.js'
import type { WalletContinuityRestoreAccessKey } from '../../continuity/envelope.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import { arrayField, numberField, objectField, stringField } from '../fieldParsers.js'
import type {
  ApprovedOperatorWalletRecord,
  EthagentBackupPointer,
  EthagentOperatorsPointer,
  EthagentPublicDiscoveryPointer,
  EthagentRegistrationPointer,
} from './types.js'

export function parseEthagentBackupPointer(registration: Record<string, unknown> | null): EthagentBackupPointer | null {
  if (!registration) return null
  const ext = objectField(registration, 'x-ethagent') ?? objectField(registration, 'ethagent')
  const backup = ext ? objectField(ext, 'backup') : null
  const cid = backup ? stringField(backup, 'cid') : undefined
  if (!cid) return null
  const agentAddress = stringField(ext, 'agentAddress')
  const transferSnapshot = backup ? parseTransferSnapshotMetadata(objectField(backup, 'transferSnapshot')) : undefined
  const pastBackupsArray = arrayField(backup ?? {}, 'pastBackups')
  const pastBackups = pastBackupsArray?.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const obj = item as Record<string, unknown>
    const itemCid = stringField(obj, 'cid')
    if (!itemCid) return []
    return [{
      cid: itemCid,
      ...(stringField(obj, 'createdAt') ? { createdAt: stringField(obj, 'createdAt') } : {}),
    }]
  })

  return {
    cid,
    envelopeVersion: backup ? stringField(backup, 'envelopeVersion') : undefined,
    createdAt: backup ? stringField(backup, 'createdAt') : undefined,
    ...(agentAddress && isAddress(agentAddress) ? { agentAddress: getAddress(agentAddress) } : {}),
    ...(transferSnapshot ? { transferSnapshot } : {}),
    ...(pastBackups && pastBackups.length > 0 ? { pastBackups } : {}),
  }
}

function parseTransferSnapshotMetadata(input: Record<string, unknown> | null): TransferSnapshotMetadata | undefined {
  if (!input) return undefined
  const kind = stringField(input, 'kind')
  const senderRaw = stringField(input, 'senderAddress')
  const receiverRaw = stringField(input, 'receiverAddress')
  const slotCount = numberField(input, 'slotCount')
  if (kind !== 'dual-wallet' || !senderRaw || !receiverRaw || !slotCount) return undefined
  if (!isAddress(senderRaw, { strict: false }) || !isAddress(receiverRaw, { strict: false })) return undefined
  return {
    kind: 'dual-wallet',
    senderAddress: getAddress(senderRaw),
    receiverAddress: getAddress(receiverRaw),
    ...(stringField(input, 'receiverHandle') ? { receiverHandle: stringField(input, 'receiverHandle') } : {}),
    slotCount,
    ...(stringField(input, 'createdAt') ? { createdAt: stringField(input, 'createdAt') } : {}),
  }
}

export function parseEthagentPublicDiscoveryPointer(registration: Record<string, unknown> | null): EthagentPublicDiscoveryPointer | null {
  if (!registration) return null
  const ext = objectField(registration, 'x-ethagent') ?? objectField(registration, 'ethagent')
  const publicSkills = ext ? objectField(ext, 'publicSkills') : null
  const agentCard = ext ? objectField(ext, 'agentCard') : null
  const skillsCid = publicSkills ? stringField(publicSkills, 'cid') : undefined
  const agentCardCid = agentCard ? stringField(agentCard, 'cid') : undefined
  const updatedAt = (publicSkills ? stringField(publicSkills, 'updatedAt') : undefined)
    ?? (agentCard ? stringField(agentCard, 'updatedAt') : undefined)
  if (!skillsCid && !agentCardCid) return null
  return {
    ...(skillsCid ? { skillsCid } : {}),
    ...(agentCardCid ? { agentCardCid } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

export function parseEthagentOperatorsPointer(registration: Record<string, unknown> | null): EthagentOperatorsPointer | null {
  if (!registration) return null
  const ext = objectField(registration, 'x-ethagent') ?? objectField(registration, 'ethagent')
  const operators = ext ? objectField(ext, 'operators') : null
  if (!operators) return null
  const approvedOperatorWallets = parseOperatorRecords(arrayField(operators, 'approvedOperatorWallets') ?? [])
  const activeRaw = stringField(operators, 'activeOperatorAddress')
  const ownerRaw = readOwnerAddressField(operators)
  const ensName = stringField(operators, 'ensName')
  const restoreAccessEpoch = numberField(operators, 'restoreAccessEpoch')
  const ownerRestoreAccessKey = parseRestoreAccessKey(objectField(operators, 'ownerRestoreAccessKey'))
  const activeOperatorAddress = activeRaw && isAddress(activeRaw, { strict: false }) ? getAddress(activeRaw) : undefined
  const ownerAddress = ownerRaw && isAddress(ownerRaw, { strict: false }) ? getAddress(ownerRaw) : undefined
  if (approvedOperatorWallets.length === 0 && !activeOperatorAddress && !ownerAddress && !ensName && !ownerRestoreAccessKey && !restoreAccessEpoch) return null
  return {
    approvedOperatorWallets,
    ...(activeOperatorAddress ? { activeOperatorAddress } : {}),
    ...(ownerAddress ? { ownerAddress } : {}),
    ...(ensName ? { ensName } : {}),
    ...(restoreAccessEpoch && Number.isSafeInteger(restoreAccessEpoch) && restoreAccessEpoch > 0 ? { restoreAccessEpoch } : {}),
    ...(ownerRestoreAccessKey ? { ownerRestoreAccessKey } : {}),
  }
}

function parseOperatorRecords(items: unknown[]): ApprovedOperatorWalletRecord[] {
  const out: ApprovedOperatorWalletRecord[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const record = parseOperatorRecord(item)
    if (!record) continue
    const key = record.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(record)
  }
  return out
}

function parseOperatorRecord(item: unknown): ApprovedOperatorWalletRecord | null {
  if (typeof item === 'string') {
    const trimmed = item.trim()
    if (!isAddress(trimmed, { strict: false })) return null
    return { address: getAddress(trimmed) }
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const obj = item as Record<string, unknown>
  const rawAddress = stringField(obj, 'address')
  if (!rawAddress || !isAddress(rawAddress, { strict: false })) return null
  const challenge = stringField(obj, 'challenge')
  const verifiedAt = stringField(obj, 'verifiedAt')
  const restoreAccessKey = parseRestoreAccessKey(objectField(obj, 'restoreAccessKey'))
  return {
    address: getAddress(rawAddress),
    ...(challenge ? { challenge } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(restoreAccessKey ? { restoreAccessKey } : {}),
  }
}

function parseRestoreAccessKey(obj: Record<string, unknown> | null): WalletContinuityRestoreAccessKey | undefined {
  if (!obj) return undefined
  const address = stringField(obj, 'address')
  const challenge = stringField(obj, 'challenge')
  const salt = stringField(obj, 'salt')
  const kemPublicKey = stringField(obj, 'kemPublicKey')
  const createdAt = stringField(obj, 'createdAt')
  if (!address || !isAddress(address, { strict: false }) || !challenge || !salt || !kemPublicKey) return undefined
  return {
    address: getAddress(address),
    challenge,
    salt,
    kemPublicKey,
    ...(createdAt ? { createdAt } : {}),
  }
}

function serializeRestoreAccessKey(key: WalletContinuityRestoreAccessKey): Record<string, unknown> {
  return {
    address: getAddress(key.address),
    challenge: key.challenge,
    salt: key.salt,
    kemPublicKey: key.kemPublicKey,
    ...(key.createdAt ? { createdAt: key.createdAt } : {}),
  }
}

function serializeOperatorsPointer(pointer: EthagentOperatorsPointer): Record<string, unknown> {
  return {
    approvedOperatorWallets: pointer.approvedOperatorWallets.map(record => ({
      address: getAddress(record.address),
      ...(record.challenge ? { challenge: record.challenge } : {}),
      ...(record.verifiedAt ? { verifiedAt: record.verifiedAt } : {}),
      ...(record.restoreAccessKey ? { restoreAccessKey: serializeRestoreAccessKey(record.restoreAccessKey) } : {}),
    })),
    ...(pointer.activeOperatorAddress ? { activeOperatorAddress: getAddress(pointer.activeOperatorAddress) } : {}),
    ...(pointer.ownerAddress ? { ownerAddress: getAddress(pointer.ownerAddress) } : {}),
    ...(pointer.ensName ? { ensName: pointer.ensName } : {}),
    ...(pointer.restoreAccessEpoch ? { restoreAccessEpoch: pointer.restoreAccessEpoch } : {}),
    ...(pointer.ownerRestoreAccessKey ? { ownerRestoreAccessKey: serializeRestoreAccessKey(pointer.ownerRestoreAccessKey) } : {}),
  }
}

export function withEthagentBackupPointer(
  registration: Record<string, unknown> | null,
  backup: EthagentBackupPointer,
  publicDiscovery: EthagentPublicDiscoveryPointer | undefined,
  registrationPointer: EthagentRegistrationPointer | undefined,
  ownerAddress: Address,
): Record<string, unknown> {
  return withEthagentPointers(registration, {
    backup,
    publicDiscovery,
    registration: registrationPointer,
    ownerAddress,
  })
}

export function withEthagentPointers(
  registration: Record<string, unknown> | null,
  pointers: {
    backup?: EthagentBackupPointer
    publicDiscovery?: EthagentPublicDiscoveryPointer
    registration?: EthagentRegistrationPointer
    ensName?: string
    operators?: EthagentOperatorsPointer
    ownerAddress: Address
  },
): Record<string, unknown> {
  const next: Record<string, unknown> = registration ? { ...registration } : {}
  const prior = objectField(next, 'x-ethagent') ?? {}
  const { backup, publicDiscovery, registration: registrationPointer, operators } = pointers
  const updatedAt = publicDiscovery?.updatedAt ?? backup?.createdAt
  if (!pointers.ownerAddress) {
    throw new Error('withEthagentPointers requires ownerAddress')
  }
  const ownerAddress = getAddress(pointers.ownerAddress)
  const priorX402 = objectField(prior, 'x402') ?? {}
  const ext: Record<string, unknown> = {
    ...prior,
    version: 1,
    agentAddress: ownerAddress,
    x402: {
      ...priorX402,
      walletAddress: ownerAddress,
    },
    ...(backup ? {
      backup: {
        cid: backup.cid,
        ...(backup.envelopeVersion ? { envelopeVersion: backup.envelopeVersion } : {}),
        ...(backup.createdAt ? { createdAt: backup.createdAt } : {}),
        ...(backup.transferSnapshot ? { transferSnapshot: serializeTransferSnapshotMetadata(backup.transferSnapshot) } : {}),
      },
    } : {}),
    ...(publicDiscovery?.skillsCid ? {
      publicSkills: {
        cid: publicDiscovery.skillsCid,
        format: 'application/json',
        ...(updatedAt ? { updatedAt } : {}),
      },
    } : {}),
    ...(publicDiscovery?.agentCardCid ? {
      agentCard: {
        cid: publicDiscovery.agentCardCid,
        format: 'application/json',
        ...(updatedAt ? { updatedAt } : {}),
      },
    } : {}),
    ...(operators ? { operators: serializeOperatorsPointer(operators) } : {}),
  }
  delete ext.transfer
  delete ext.handoff
  next['x-ethagent'] = ext
  const agentWalletService = registrationPointer
    ? { name: 'agentWallet' as const, endpoint: `eip155:${registrationPointer.chainId}:${ownerAddress}` }
    : undefined
  if (publicDiscovery || agentWalletService) {
    next.services = withEthagentServices(next.services, publicDiscovery, pointers.ensName, agentWalletService)
  }
  if (registrationPointer && registrationPointer.agentId !== undefined) {
    next.registrations = withRegistrationsArray(next.registrations, registrationPointer)
  }
  return next
}

function serializeTransferSnapshotMetadata(metadata: TransferSnapshotMetadata): Record<string, unknown> {
  return {
    kind: 'dual-wallet',
    senderAddress: getAddress(metadata.senderAddress),
    receiverAddress: getAddress(metadata.receiverAddress),
    ...(metadata.receiverHandle ? { receiverHandle: metadata.receiverHandle } : {}),
    slotCount: metadata.slotCount,
    ...(metadata.createdAt ? { createdAt: metadata.createdAt } : {}),
  }
}

function withEthagentServices(
  input: unknown,
  publicDiscovery: EthagentPublicDiscoveryPointer | undefined,
  ensName: string | undefined,
  agentWallet: { name: 'agentWallet'; endpoint: string } | undefined,
): unknown[] {
  const prior = Array.isArray(input) ? input.filter(item => item && typeof item === 'object') : []
  const services = prior.filter(item => !isEthagentManagedService(item)) as unknown[]
  if (agentWallet) {
    pushUniqueService(services, agentWallet)
  }
  if (publicDiscovery?.agentCardCid) {
    const endpoint = `ipfs://${publicDiscovery.agentCardCid}`
    pushUniqueService(services, {
      type: 'a2a',
      name: 'agent-card',
      endpoint,
      url: endpoint,
    })
  }
  if (publicDiscovery?.skillsCid) {
    const endpoint = `ipfs://${publicDiscovery.skillsCid}`
    pushUniqueService(services, {
      type: 'A2A-skills',
      name: 'public-skills',
      endpoint,
      url: endpoint,
    })
  }
  if (ensName) {
    services.push({ name: 'ENS', endpoint: ensName, version: 'v1' })
  }
  return services
}

function pushUniqueService(services: unknown[], service: Record<string, string>): void {
  const duplicate = services.some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const obj = item as Record<string, unknown>
    return obj.type === service.type && obj.endpoint === service.endpoint
  })
  if (!duplicate) services.push(service)
}

function isEthagentManagedService(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const obj = item as Record<string, unknown>
  const type = obj.type
  const name = obj.name
  if (name === 'agentWallet') return true
  if (name === 'ENS') return true
  if (type === 'a2a' && (name === undefined || name === 'agent-card')) return true
  return (type === 'A2A-skills' || type === 'ipfs') && name === 'public-skills'
}

function withRegistrationsArray(_input: unknown, registration: EthagentRegistrationPointer): unknown[] {
  return [{
    agentId: registrationAgentIdValue(registration.agentId),
    agentRegistry: `eip155:${registration.chainId}:${registration.identityRegistryAddress}`,
  }]
}

function registrationAgentIdValue(agentId: string | number | undefined): string | number | undefined {
  if (typeof agentId === 'number') return agentId
  if (typeof agentId !== 'string') return agentId
  const trimmed = agentId.trim()
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) return agentId
  const numeric = Number(trimmed)
  return Number.isSafeInteger(numeric) ? numeric : agentId
}
