import { encodeFunctionData, namehash, type Address, type Hex } from 'viem'
import type { DiscoverOptions } from './types.js'
import { RESOLVER_ABI } from './constants.js'
import { splitSubdomainName } from './names.js'
import { readResolverAddress } from './resolve.js'

export type EncodedEnsRecordTransaction = {
  resolverAddress: Address
  data: Hex
  multicall: boolean
  calls: Hex[]
}

export async function encodeSetEnsip25TextRecord(
  fullName: string,
  records: Record<string, string>,
  opts: DiscoverOptions = {},
): Promise<EncodedEnsRecordTransaction> {
  if (!splitSubdomainName(fullName)) {
    throw new Error('Agent ENS records must be written to a subdomain, not a root .eth name')
  }
  const resolver = await readResolverAddress(fullName, opts)
  if (!resolver) {
    throw new Error(`no resolver set on ${fullName} - set one in the official ENS app first`)
  }
  const node = namehash(fullName)
  const entries = Object.entries(records)
  if (entries.length === 0) {
    throw new Error('No ENS records to update')
  }
  const calls: Hex[] = entries.map(([key, value]) => encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: 'setText',
    args: [node, key, value],
  }))
  if (calls.length === 1) {
    return { resolverAddress: resolver, data: calls[0]!, multicall: false, calls }
  }
  const data = encodeFunctionData({
    abi: RESOLVER_ABI,
    functionName: 'multicall',
    args: [calls],
  })
  return { resolverAddress: resolver, data, multicall: true, calls }
}
