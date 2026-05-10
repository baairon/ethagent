import {
  encodeFunctionData,
  labelhash,
  namehash,
} from 'viem'
import {
  DEFAULT_EXPIRY,
  DEFAULT_FUSES,
  DEFAULT_TTL,
  ENS_AUTOMATION_NAME_WRAPPER_ABI,
  ENS_AUTOMATION_REGISTRY_ABI,
  ENS_AUTOMATION_RESOLVER_ABI,
  ENS_NAME_WRAPPER_ADDRESS_MAINNET,
  ENS_REGISTRY_ADDRESS_MAINNET,
  ZERO_ADDRESS,
} from './contracts.js'
import type {
  EncodedEnsTransaction,
  EnsSetupPlan,
} from './types.js'

export function encodeEnsRegistryTransaction(setup: EnsSetupPlan): EncodedEnsTransaction | null {
  const rootNode = namehash(setup.rootName)
  const fullNode = namehash(setup.fullName)
  if (setup.registryAction === 'create-subdomain') {
    const data = encodeFunctionData({
      abi: ENS_AUTOMATION_REGISTRY_ABI,
      functionName: 'setSubnodeRecord',
      args: [rootNode, labelhash(setup.label), setup.ownerAddress, setup.resolverAddress, DEFAULT_TTL],
    })
    return { to: ENS_REGISTRY_ADDRESS_MAINNET, data, calls: [data] }
  }
  if (setup.registryAction === 'create-wrapped-subdomain') {
    const data = encodeFunctionData({
      abi: ENS_AUTOMATION_NAME_WRAPPER_ABI,
      functionName: 'setSubnodeRecord',
      args: [rootNode, setup.label, setup.ownerAddress, setup.resolverAddress, DEFAULT_TTL, DEFAULT_FUSES, DEFAULT_EXPIRY],
    })
    return { to: ENS_NAME_WRAPPER_ADDRESS_MAINNET, data, calls: [data] }
  }
  if (setup.registryAction === 'set-resolver') {
    const data = encodeFunctionData({
      abi: ENS_AUTOMATION_REGISTRY_ABI,
      functionName: 'setResolver',
      args: [fullNode, setup.resolverAddress],
    })
    return { to: ENS_REGISTRY_ADDRESS_MAINNET, data, calls: [data] }
  }
  if (setup.registryAction === 'set-wrapped-resolver') {
    const data = encodeFunctionData({
      abi: ENS_AUTOMATION_NAME_WRAPPER_ABI,
      functionName: 'setResolver',
      args: [fullNode, setup.resolverAddress],
    })
    return { to: ENS_NAME_WRAPPER_ADDRESS_MAINNET, data, calls: [data] }
  }
  return null
}

export function encodeEnsRecordsTransaction(setup: EnsSetupPlan): EncodedEnsTransaction | null {
  const node = namehash(setup.fullName)
  const calls: `0x${string}`[] = []
  if (setup.addressRecord.changed) {
    calls.push(encodeFunctionData({
      abi: ENS_AUTOMATION_RESOLVER_ABI,
      functionName: 'setAddr',
      args: [node, setup.addressRecord.next],
    }))
  }
  for (const diff of setup.recordDiffs) {
    if (!diff.changed) continue
    calls.push(encodeFunctionData({
      abi: ENS_AUTOMATION_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, diff.key, diff.next],
    }))
  }
  if (calls.length === 0) return null
  const data = calls.length === 1
    ? calls[0]!
    : encodeFunctionData({
        abi: ENS_AUTOMATION_RESOLVER_ABI,
        functionName: 'multicall',
        args: [calls],
      })
  return { to: setup.resolverAddress, data, calls }
}

export function encodeDeleteSubnodeRegistry(parentName: string, label: string): EncodedEnsTransaction {
  const parentNode = namehash(parentName)
  const data = encodeFunctionData({
    abi: ENS_AUTOMATION_REGISTRY_ABI,
    functionName: 'setSubnodeRecord',
    args: [parentNode, labelhash(label), ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_TTL],
  })
  return { to: ENS_REGISTRY_ADDRESS_MAINNET, data, calls: [data] }
}

export function encodeDeleteSubnodeWrapped(parentName: string, label: string): EncodedEnsTransaction {
  const parentNode = namehash(parentName)
  const data = encodeFunctionData({
    abi: ENS_AUTOMATION_NAME_WRAPPER_ABI,
    functionName: 'setSubnodeRecord',
    args: [parentNode, label, ZERO_ADDRESS, ZERO_ADDRESS, DEFAULT_TTL, DEFAULT_FUSES, DEFAULT_EXPIRY],
  })
  return { to: ENS_NAME_WRAPPER_ADDRESS_MAINNET, data, calls: [data] }
}
