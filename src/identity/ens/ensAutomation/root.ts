import { getAddress, namehash, type Address } from 'viem'
import { normalizeEthDomain } from '../ensLookup.js'
import { validateErc8004TokenOwner } from '../../registry/erc8004.js'
import { ENS_NAME_WRAPPER_ADDRESS_MAINNET } from './contracts.js'
import { isRootEthName } from './names.js'
import {
  createEnsAutomationClient,
  isZero,
  readOwner,
  readWrappedOwner,
  sameAddress,
  shortHex,
} from './read.js'
import type {
  EnsRootPreflightArgs,
  EnsRootPreflightResult,
} from './types.js'

export async function preflightEnsRoot(args: EnsRootPreflightArgs): Promise<EnsRootPreflightResult> {
  const rootName = normalizeEthDomain(args.rootName)
  if (!isRootEthName(rootName)) {
    return { ok: false, reason: 'invalid-root', detail: 'Enter the parent .eth name, e.g. name.eth' }
  }
  if (args.agentId === undefined || args.agentId === '') {
    return { ok: false, reason: 'missing-token-id', detail: 'this identity is missing an ERC-8004 token id' }
  }
  const expectedOwnerAddress = getAddress(args.expectedOwnerAddress)
  const client = args.ensClient ?? createEnsAutomationClient()
  const rootNode = namehash(rootName)
  let rootOwner: Address
  try {
    rootOwner = await readOwner(client, rootNode)
  } catch (err: unknown) {
    return { ok: false, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (isZero(rootOwner)) {
    return { ok: false, reason: 'root-not-owned', detail: `${rootName} does not have an ENS manager on Ethereum mainnet` }
  }
  const parentWrapped = sameAddress(rootOwner, ENS_NAME_WRAPPER_ADDRESS_MAINNET)
  let ownerAddress: Address
  try {
    ownerAddress = parentWrapped ? await readWrappedOwner(client, rootNode) : getAddress(rootOwner)
  } catch (err: unknown) {
    return { ok: false, reason: 'wrapped-parent', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!sameAddress(ownerAddress, expectedOwnerAddress)) {
    return {
      ok: false,
      reason: 'root-owner-mismatch',
      detail: `${rootName} is managed by ${shortHex(ownerAddress)}, not the connected wallet ${shortHex(expectedOwnerAddress)}`,
    }
  }
  const tokenOwner = await validateErc8004TokenOwner({
    ...args.registry,
    agentId: typeof args.agentId === 'bigint' ? args.agentId : BigInt(args.agentId),
    expectedOwner: ownerAddress,
    publicClient: args.tokenPublicClient,
  })
  if (!tokenOwner.ok) {
    return { ok: false, reason: tokenOwner.reason, detail: tokenOwner.detail }
  }
  return { ok: true, ownerAddress }
}
