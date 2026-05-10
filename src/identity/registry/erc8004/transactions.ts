import { decodeEventLog, encodeFunctionData, getAddress, type Address, type Hex } from 'viem'
import { ERC8004_ABI, REGISTERED_EVENT, TRANSFER_EVENT } from './abi.js'

type ReceiptLog = { address?: Address; topics: readonly Hex[]; data: Hex }

export function encodeRegisterAgent(args: {
  agentURI: string
}): Hex {
  return encodeFunctionData({
    abi: ERC8004_ABI,
    functionName: 'register',
    args: [args.agentURI],
  })
}

export function encodeSetAgentUri(args: {
  agentId: bigint
  newUri: string
}): Hex {
  return encodeFunctionData({
    abi: ERC8004_ABI,
    functionName: 'setAgentURI',
    args: [args.agentId, args.newUri],
  })
}

export function registeredAgentFromReceipt(args: {
  logs: ReceiptLog[]
  identityRegistryAddress: Address
  ownerAddress?: Address
  fallbackAgentURI?: string
}): { agentId: bigint; agentURI: string; owner: Address } {
  for (const log of args.logs) {
    if (log.address && log.address.toLowerCase() !== args.identityRegistryAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: [REGISTERED_EVENT],
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      })
      if (decoded.eventName !== 'Registered') continue
      const eventArgs = decoded.args as { agentId?: bigint; agentURI?: string; owner?: Address }
      if (eventArgs.agentId === undefined || !eventArgs.agentURI || !eventArgs.owner) continue
      if (args.ownerAddress && eventArgs.owner.toLowerCase() !== args.ownerAddress.toLowerCase()) continue
      return {
        agentId: eventArgs.agentId,
        agentURI: eventArgs.agentURI,
        owner: getAddress(eventArgs.owner),
      }
    } catch {
    }
  }
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  for (const log of args.logs) {
    if (log.address && log.address.toLowerCase() !== args.identityRegistryAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      })
      if (decoded.eventName !== 'Transfer') continue
      const eventArgs = decoded.args as { from?: Address; to?: Address; tokenId?: bigint }
      if (!eventArgs.from || !eventArgs.to || eventArgs.tokenId === undefined) continue
      if (eventArgs.from.toLowerCase() !== ZERO_ADDRESS) continue
      if (args.ownerAddress && eventArgs.to.toLowerCase() !== args.ownerAddress.toLowerCase()) continue
      const agentURI = args.fallbackAgentURI ?? ''
      return {
        agentId: eventArgs.tokenId,
        agentURI,
        owner: getAddress(eventArgs.to),
      }
    } catch {
    }
  }
  throw new Error('ERC-8004 registration event was not found in transaction receipt')
}
