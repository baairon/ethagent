import { getAddress, namehash, type Address } from 'viem'
import { isEthDomain, normalizeEthDomain, splitSubdomainName } from '../ensLookup.js'
import { ENS_NAME_WRAPPER_ADDRESS_MAINNET } from './contracts.js'
import {
  createEnsAutomationClient,
  isZero,
  readOwner,
  readWrappedOwner,
  sameAddress,
  shortHex,
} from './read.js'
import {
  encodeDeleteSubnodeRegistry,
  encodeDeleteSubnodeWrapped,
} from './transactions.js'
import type {
  EnsSubdomainDeletePreflightArgs,
  EnsSubdomainDeletePreflightResult,
} from './types.js'

export async function preflightDeleteSubdomain(args: EnsSubdomainDeletePreflightArgs): Promise<EnsSubdomainDeletePreflightResult> {
  const fullName = normalizeEthDomain(args.fullName)
  if (!isEthDomain(fullName)) {
    return { ok: false, reason: 'invalid-name', detail: `${args.fullName} is not a valid .eth name` }
  }
  const parts = splitSubdomainName(fullName)
  if (!parts) {
    return { ok: false, reason: 'not-a-subdomain', detail: `${fullName} is not a subdomain` }
  }
  const expectedOwner = getAddress(args.expectedOwnerAddress)
  const client = args.ensClient ?? createEnsAutomationClient()
  const parentNode = namehash(parts.parent)
  const fullNode = namehash(fullName)
  let parentOwner: Address
  try {
    parentOwner = await readOwner(client, parentNode)
  } catch (err: unknown) {
    return { ok: false, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (isZero(parentOwner)) {
    return { ok: false, reason: 'parent-not-owned', detail: `${parts.parent} does not have an ENS manager on Ethereum mainnet` }
  }
  const parentWrapped = sameAddress(parentOwner, ENS_NAME_WRAPPER_ADDRESS_MAINNET)
  let parentOwnerAddress: Address
  try {
    parentOwnerAddress = parentWrapped ? await readWrappedOwner(client, parentNode) : getAddress(parentOwner)
  } catch (err: unknown) {
    return { ok: false, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!sameAddress(parentOwnerAddress, expectedOwner)) {
    return {
      ok: false,
      reason: 'parent-owner-mismatch',
      detail: `${parts.parent} is managed by ${shortHex(parentOwnerAddress)}, not the connected wallet ${shortHex(expectedOwner)}`,
    }
  }
  let childOwner: Address
  try {
    childOwner = await readOwner(client, fullNode)
  } catch (err: unknown) {
    return { ok: false, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (isZero(childOwner)) {
    return { ok: false, reason: 'subdomain-missing', detail: `${fullName} is already cleared on Ethereum mainnet` }
  }
  const transaction = parentWrapped
    ? encodeDeleteSubnodeWrapped(parts.parent, parts.label)
    : encodeDeleteSubnodeRegistry(parts.parent, parts.label)
  return {
    ok: true,
    plan: {
      fullName,
      parentName: parts.parent,
      label: parts.label,
      parentWrapped,
      parentOwnerAddress,
      transaction,
    },
  }
}
