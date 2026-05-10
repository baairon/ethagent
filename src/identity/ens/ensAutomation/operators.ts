import { getAddress, type Address } from 'viem'
import type { OperatorSetDiff } from './types.js'

export function compareOperatorSets(args: {
  metadataOperators: ReadonlyArray<{ address: string }>
  resolverDelegates: ReadonlyArray<string>
}): OperatorSetDiff {
  const metadata = new Map<string, Address>()
  for (const record of args.metadataOperators) {
    metadata.set(record.address.toLowerCase(), getAddress(record.address))
  }
  const resolver = new Map<string, Address>()
  for (const raw of args.resolverDelegates) {
    resolver.set(raw.toLowerCase(), getAddress(raw))
  }
  const metadataOnly: Address[] = []
  for (const [key, addr] of metadata) {
    if (!resolver.has(key)) metadataOnly.push(addr)
  }
  const resolverOnly: Address[] = []
  for (const [key, addr] of resolver) {
    if (!metadata.has(key)) resolverOnly.push(addr)
  }
  return {
    inSync: metadataOnly.length === 0 && resolverOnly.length === 0,
    metadataOnly,
    resolverOnly,
  }
}
