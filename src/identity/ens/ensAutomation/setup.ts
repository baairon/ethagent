import { getAddress, namehash, type Address } from 'viem'
import {
  buildAgentEnsRecords,
  diffRecords,
} from '../agentRecords.js'
import { normalizeEthDomain, splitSubdomainName } from '../ensLookup.js'
import { validateErc8004TokenOwner } from '../../registry/erc8004.js'
import {
  ENS_NAME_WRAPPER_ADDRESS_MAINNET,
  ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET,
} from './contracts.js'
import {
  createEnsAutomationClient,
  isZero,
  normalizeAgentRecords,
  readAddressRecord,
  readOwner,
  readResolver,
  readTextRecords,
  readWrappedOwner,
  sameAddress,
  shortHex,
} from './read.js'
import {
  hasValidSubdomainParts,
  isRootEthName,
  isValidSubdomainLabel,
} from './names.js'
import type {
  EnsSetupBlockedPlan,
  EnsSetupPreflight,
  EnsSetupPreflightArgs,
  EnsRegistryAction,
} from './types.js'

export async function preflightEnsSetup(args: EnsSetupPreflightArgs): Promise<EnsSetupPreflight> {
  const rootName = normalizeEthDomain(args.rootName)
  const label = args.label.trim().toLowerCase()
  const operatorAddress = getAddress(args.operatorAddress)
  const mode = args.mode ?? 'advanced'
  const fullName = `${label}.${rootName}`

  if (!isRootEthName(rootName)) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      reason: 'invalid-root',
      detail: 'Enter the parent .eth name, e.g. name.eth',
    })
  }
  if (!isValidSubdomainLabel(label) || !hasValidSubdomainParts(fullName)) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      reason: 'invalid-label',
      detail: 'Agent subdomain can use lowercase letters, numbers, and hyphens only',
    })
  }
  if (args.agentId === undefined || args.agentId === '') {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      reason: 'missing-token-id',
      detail: 'This identity is missing an ERC-8004 token id',
    })
  }

  const client = args.ensClient ?? createEnsAutomationClient()
  const rootNode = namehash(rootName)
  const fullNode = namehash(fullName)

  let rootOwner: Address
  try {
    rootOwner = await readOwner(client, rootNode)
  } catch (err: unknown) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      reason: 'lookup-failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  if (isZero(rootOwner)) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      reason: 'root-not-owned',
      detail: `${rootName} does not have an ENS manager on Ethereum mainnet`,
    })
  }
  const parentWrapped = sameAddress(rootOwner, ENS_NAME_WRAPPER_ADDRESS_MAINNET)
  let ownerAddress: Address
  try {
    ownerAddress = parentWrapped
      ? await readWrappedOwner(client, rootNode)
      : getAddress(rootOwner)
  } catch (err: unknown) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      reason: 'wrapped-parent',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
  const expectedOwnerAddress = args.expectedOwnerAddress ? getAddress(args.expectedOwnerAddress) : null
  if (expectedOwnerAddress && !sameAddress(ownerAddress, expectedOwnerAddress)) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      ownerAddress,
      reason: 'root-owner-mismatch',
      detail: `${rootName} is managed by ${shortHex(ownerAddress)}, not the connected wallet ${shortHex(expectedOwnerAddress)}`,
    })
  }
  if (!args.allowSameOwnerOperator && sameAddress(ownerAddress, operatorAddress)) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      ownerAddress,
      reason: 'operator-matches-owner',
      detail: 'Operator wallet must be different from the owner wallet that owns the ERC-8004 token and parent ENS name',
    })
  }

  const tokenOwner = await validateErc8004TokenOwner({
    ...args.registry,
    agentId: typeof args.agentId === 'bigint' ? args.agentId : BigInt(args.agentId),
    expectedOwner: ownerAddress,
    publicClient: args.tokenPublicClient,
  })
  if (!tokenOwner.ok) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      ownerAddress,
      reason: tokenOwner.reason,
      detail: tokenOwner.detail,
    })
  }

  let childOwner: Address
  let childResolver: Address
  try {
    childOwner = await readOwner(client, fullNode)
    childResolver = await readResolver(client, fullNode)
  } catch (err: unknown) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      ownerAddress,
      reason: 'lookup-failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  let registryAction: EnsRegistryAction = 'none'
  let resolverAddress = getAddress(childResolver)
  if (isZero(childOwner)) {
    registryAction = parentWrapped ? 'create-wrapped-subdomain' : 'create-subdomain'
    resolverAddress = ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET
  } else if (sameAddress(childOwner, ENS_NAME_WRAPPER_ADDRESS_MAINNET)) {
    let wrappedChildOwner: Address
    try {
      wrappedChildOwner = await readWrappedOwner(client, fullNode)
    } catch (err: unknown) {
      return manual(args, {
        rootName,
        label,
        fullName,
        operatorAddress,
        ownerAddress,
        reason: 'subdomain-wrapped',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    if (!sameAddress(wrappedChildOwner, ownerAddress)) {
      return manual(args, {
        rootName,
        label,
        fullName,
        operatorAddress,
        ownerAddress,
        reason: 'subdomain-owned-by-other',
        detail: `${fullName} is wrapped and owned by ${getAddress(wrappedChildOwner)}`,
      })
    }
    if (isZero(childResolver)) {
      registryAction = 'set-wrapped-resolver'
      resolverAddress = ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET
    }
  } else if (!sameAddress(childOwner, ownerAddress)) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      ownerAddress,
      reason: 'subdomain-owned-by-other',
      detail: `${fullName} is managed by ${shortHex(getAddress(childOwner))}`,
    })
  } else if (isZero(childResolver)) {
    registryAction = 'set-resolver'
    resolverAddress = ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET
  }

  const currentAddress = isZero(childResolver) ? null : await readAddressRecord(client, resolverAddress, fullNode)
  const currentRecords = normalizeAgentRecords(isZero(childResolver) ? {} : await readTextRecords(client, resolverAddress, fullNode))
  const nextRecords = buildAgentEnsRecords({
    chainId: args.registry.chainId,
    identityRegistryAddress: args.registry.identityRegistryAddress,
    agentId: String(args.agentId),
  })
  if (currentRecords.token && nextRecords.token && currentRecords.token !== nextRecords.token) {
    return manual(args, {
      rootName,
      label,
      fullName,
      operatorAddress,
      ownerAddress,
      resolverAddress,
      reason: 'token-record-collision',
      detail: `${fullName} already points to another ERC-8004 token`,
      currentRecords,
      nextRecords,
    })
  }

  const recordDiffs = diffRecords(currentRecords, nextRecords)
  const addressChanged = !currentAddress || !sameAddress(currentAddress, ownerAddress)
  const needsRegistryTx = registryAction !== 'none'
  const needsRecordsTx = addressChanged || recordDiffs.some(diff => diff.changed)
  return {
    ok: true,
    setup: {
      mode,
      rootName,
      label,
      fullName,
      ownerAddress,
      operatorAddress,
      resolverAddress,
      registryAction,
      addressRecord: {
        current: currentAddress,
        next: ownerAddress,
        changed: addressChanged,
      },
      currentRecords,
      nextRecords,
      recordDiffs,
      txCount: (needsRegistryTx ? 1 : 0) + (needsRecordsTx ? 1 : 0),
      warnings: [],
    },
  }
}

function manual(
  args: EnsSetupPreflightArgs,
  fallback: Omit<EnsSetupBlockedPlan, 'mode'> & Partial<Pick<EnsSetupBlockedPlan, 'mode'>>,
): EnsSetupPreflight {
  return { ok: false, fallback: { ...fallback, mode: args.mode ?? 'advanced' } }
}
