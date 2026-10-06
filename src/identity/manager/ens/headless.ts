import {
  encodeFunctionData,
  getAddress,
  labelhash,
  namehash,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  buildAgentEnsRecords,
  diffRecords,
  type AgentEnsRecordState,
  type AgentEnsRecords,
  type AgentRecordDiff,
} from '../../ens/agentRecords.js'
import { normalizeEthDomain, splitSubdomainName } from '../../ens/ensLookup.js'
import {
  ENS_AUTOMATION_RESOLVER_ABI,
  ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET,
} from '../../ens/ensAutomation.js'
import {
  ENS_AUTOMATION_NAME_WRAPPER_ABI,
  ENS_AUTOMATION_REGISTRY_ABI,
  ENS_NAME_WRAPPER_ADDRESS_MAINNET,
  ENS_REGISTRY_ADDRESS_MAINNET,
  DEFAULT_EXPIRY,
  DEFAULT_FUSES,
  DEFAULT_TTL,
} from '../../ens/ensAutomation/contracts.js'
import { readAddressRecord, readTextRecords } from '../../ens/ensAutomation/read.js'
import { readDelegation } from '../../ens/resolverDelegation.js'
import type { WalletPurpose } from '../../wallet/browserWallet.js'
import { agentEnsRecordKeys } from './records.js'

export type EnsReadClient = Pick<PublicClient, 'readContract'>

const ZERO = '0x0000000000000000000000000000000000000000'

function isZero(address: string): boolean {
  return address.toLowerCase() === ZERO
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

// Who controls a name: the registry owner, or for a wrapped name the NameWrapper
// owner, and which resolver holds its records.
export type EnsNameControl = {
  name: string
  node: Hex
  exists: boolean
  wrapped: boolean
  owner: Address | null
  registryOwner: Address | null
  resolver: Address | null
}

export async function readNameControl(client: EnsReadClient, name: string): Promise<EnsNameControl> {
  const fullName = normalizeEthDomain(name)
  const node = namehash(fullName)
  const registryOwner = getAddress(await client.readContract({
    address: ENS_REGISTRY_ADDRESS_MAINNET,
    abi: ENS_AUTOMATION_REGISTRY_ABI,
    functionName: 'owner',
    args: [node],
  }) as Address)
  const resolver = getAddress(await client.readContract({
    address: ENS_REGISTRY_ADDRESS_MAINNET,
    abi: ENS_AUTOMATION_REGISTRY_ABI,
    functionName: 'resolver',
    args: [node],
  }) as Address)
  const exists = !isZero(registryOwner)
  const wrapped = exists && same(registryOwner, ENS_NAME_WRAPPER_ADDRESS_MAINNET)
  const owner = !exists
    ? null
    : wrapped
      ? getAddress(await client.readContract({
          address: ENS_NAME_WRAPPER_ADDRESS_MAINNET,
          abi: ENS_AUTOMATION_NAME_WRAPPER_ABI,
          functionName: 'ownerOf',
          args: [BigInt(node)],
        }) as Address)
      : registryOwner
  return {
    name: fullName,
    node,
    exists,
    wrapped,
    owner,
    registryOwner: exists ? registryOwner : null,
    resolver: isZero(resolver) ? null : resolver,
  }
}

export type SignerControl = 'owner' | 'wrapped-owner' | 'resolver-delegate' | null

// Whether the signer may write this name's resolver records: as the registry owner,
// the NameWrapper owner, or a delegate the owner approved on the resolver.
export async function signerControlOf(client: EnsReadClient, control: EnsNameControl, signer: Address): Promise<SignerControl> {
  if (!control.exists || !control.owner) return null
  if (same(control.owner, signer)) return control.wrapped ? 'wrapped-owner' : 'owner'
  if (!control.resolver) return null
  const delegated = await readDelegation({
    client,
    resolverAddress: control.resolver,
    ownerAddress: control.owner,
    node: control.node,
    delegateAddress: signer,
  })
  return delegated ? 'resolver-delegate' : null
}

export type EnsPlannedTransaction = {
  step: 'create-subdomain' | 'set-records' | 'clear-old-records' | 'clear-records' | 'update-records'
  name: string
  to: Address
  data: Hex
  purpose: WalletPurpose
  description: string
  // Simulating this before the steps ahead of it ran would read a name that does not
  // exist yet, so it is simulated only as part of the real run.
  dependsOnPrevious: boolean
}

export class EnsPlanRefusal extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
    this.name = 'EnsPlanRefusal'
  }
}

function textCalls(node: Hex, writes: Record<string, string>): Hex[] {
  return Object.entries(writes).map(([key, value]) => encodeFunctionData({
    abi: ENS_AUTOMATION_RESOLVER_ABI,
    functionName: 'setText',
    args: [node, key, value],
  }))
}

function multicall(calls: Hex[]): Hex {
  return calls.length === 1
    ? calls[0]!
    : encodeFunctionData({ abi: ENS_AUTOMATION_RESOLVER_ABI, functionName: 'multicall', args: [calls] })
}

export function describeWrites(writes: Record<string, string>): string {
  return Object.entries(writes)
    .map(([key, value]) => (value ? `set ${key} = ${value}` : `clear ${key}`))
    .join('; ')
}

async function requireControl(client: EnsReadClient, control: EnsNameControl, signer: Address, role: string): Promise<SignerControl> {
  if (!control.exists) throw new EnsPlanRefusal(`${control.name} does not exist on ENS.`)
  if (!control.resolver) {
    throw new EnsPlanRefusal(`${control.name} has no resolver, so its records cannot be written.`, 'Set a resolver for it in the ENS app first. Nothing was sent.')
  }
  const how = await signerControlOf(client, control, signer)
  if (!how) {
    throw new EnsPlanRefusal(
      `The ${role} ${signer} does not control ${control.name} (managed by ${control.owner ?? 'nobody'}).`,
      'Use the wallet that owns the name, or approve this wallet as a delegate on its resolver. Nothing was sent.',
    )
  }
  return how
}

async function clearOldRecordsTx(args: {
  client: EnsReadClient
  oldName: string
  signer: Address
  role: string
  keys: readonly string[]
  step: 'clear-old-records' | 'clear-records'
}): Promise<{ tx: EnsPlannedTransaction | null; current: AgentEnsRecordState }> {
  const control = await readNameControl(args.client, args.oldName)
  if (!control.exists || !control.resolver) return { tx: null, current: {} }
  const current = await readTextRecords(args.client, control.resolver, control.node, args.keys)
  const writes: Record<string, string> = {}
  for (const key of Object.keys(current)) writes[key] = ''
  if (Object.keys(writes).length === 0) return { tx: null, current }
  await requireControl(args.client, control, args.signer, args.role)
  return {
    current,
    tx: {
      step: args.step,
      name: control.name,
      to: control.resolver,
      data: multicall(textCalls(control.node, writes)),
      purpose: 'clear-ens-records',
      description: `${control.name}: ${describeWrites(writes)}`,
      dependsOnPrevious: false,
    },
  }
}

export type EnsSwapPlan = {
  kind: 'swap'
  newName: string
  oldName: string | null
  create: boolean
  transactions: EnsPlannedTransaction[]
  nextRecords: AgentEnsRecords
  recordDiffs: AgentRecordDiff[]
}

// Points the agent at a new name: creates it when it is missing and the signer controls
// the parent, writes the agent records on it in one resolver multicall (and addr only on
// a name it just created), and clears the agent records on the old name. Everything is
// checked before anything is sent; the owner-signed publish of the name is separate.
export async function planEnsSwap(args: {
  client: EnsReadClient
  newName: string
  oldName?: string | null
  signer: Address
  signerRole: string
  agentOwner: Address
  chainId: number
  identityRegistryAddress: Address
  agentId: string
}): Promise<EnsSwapPlan> {
  const newName = normalizeEthDomain(args.newName)
  const parts = splitSubdomainName(newName)
  if (!parts) {
    throw new EnsPlanRefusal(`${args.newName} is not an agent subdomain.`, 'Agent names are subdomains such as agent.yourname.eth.')
  }
  const oldName = args.oldName ? normalizeEthDomain(args.oldName) : null
  if (oldName === newName) {
    throw new EnsPlanRefusal(`${newName} is already the agent's name.`, 'Use `ethagent ens` to check it, or `ethagent ens --set` to change its records.')
  }
  const nextRecords = buildAgentEnsRecords({
    chainId: args.chainId,
    identityRegistryAddress: args.identityRegistryAddress,
    agentId: args.agentId,
  })
  const transactions: EnsPlannedTransaction[] = []
  const control = await readNameControl(args.client, newName)
  const node = namehash(newName)
  let create = false
  let current: AgentEnsRecordState = {}
  let resolver: Address
  if (!control.exists) {
    const parent = await readNameControl(args.client, parts.parent)
    if (!parent.exists || !parent.owner || !same(parent.owner, args.signer)) {
      throw new EnsPlanRefusal(
        `${newName} does not exist, and the ${args.signerRole} ${args.signer} does not control its parent ${parts.parent}${parent.owner ? ` (managed by ${parent.owner})` : ''}.`,
        'Create the name in the ENS app, or sign with the wallet that owns the parent. Nothing was sent.',
      )
    }
    create = true
    resolver = ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET
    const data = parent.wrapped
      ? encodeFunctionData({
          abi: ENS_AUTOMATION_NAME_WRAPPER_ABI,
          functionName: 'setSubnodeRecord',
          args: [parent.node, parts.label, args.signer, resolver, DEFAULT_TTL, DEFAULT_FUSES, DEFAULT_EXPIRY],
        })
      : encodeFunctionData({
          abi: ENS_AUTOMATION_REGISTRY_ABI,
          functionName: 'setSubnodeRecord',
          args: [parent.node, labelhash(parts.label), args.signer, resolver, DEFAULT_TTL],
        })
    transactions.push({
      step: 'create-subdomain',
      name: newName,
      to: parent.wrapped ? ENS_NAME_WRAPPER_ADDRESS_MAINNET : ENS_REGISTRY_ADDRESS_MAINNET,
      data,
      purpose: 'create-simple-ens-subdomain',
      description: `create ${newName} under ${parts.parent}, managed by ${args.signer}, on the public resolver`,
      dependsOnPrevious: false,
    })
  } else {
    await requireControl(args.client, control, args.signer, args.signerRole)
    resolver = control.resolver!
    const addr = await readAddressRecord(args.client, resolver, node)
    if (!addr || !same(addr, args.agentOwner)) {
      throw new EnsPlanRefusal(
        `${newName} resolves to ${addr ?? 'no address'}, not the agent owner ${args.agentOwner}.`,
        'Set its address to the owner wallet in the ENS app first; ethagent writes addr only on a name it creates. Nothing was sent.',
      )
    }
    current = await readTextRecords(args.client, resolver, node, Object.keys(nextRecords))
  }
  const recordDiffs = diffRecords(current, nextRecords)
  const writes: Record<string, string> = {}
  for (const diff of recordDiffs) if (diff.changed) writes[diff.key] = diff.next
  const calls: Hex[] = []
  if (create) {
    calls.push(encodeFunctionData({ abi: ENS_AUTOMATION_RESOLVER_ABI, functionName: 'setAddr', args: [node, args.agentOwner] }))
  }
  calls.push(...textCalls(node, writes))
  if (calls.length > 0) {
    transactions.push({
      step: 'set-records',
      name: newName,
      to: resolver,
      data: multicall(calls),
      purpose: 'set-agent-ens-records',
      description: `${newName}: ${[create ? `set addr = ${args.agentOwner}` : '', describeWrites(writes)].filter(Boolean).join('; ')}`,
      dependsOnPrevious: create,
    })
  }
  if (oldName) {
    const cleared = await clearOldRecordsTx({
      client: args.client,
      oldName,
      signer: args.signer,
      role: args.signerRole,
      keys: agentEnsRecordKeys(args.identityRegistryAddress, args.agentId),
      step: 'clear-old-records',
    })
    if (cleared.tx) transactions.push(cleared.tx)
  }
  return { kind: 'swap', newName, oldName, create, transactions, nextRecords, recordDiffs }
}

export type EnsUnlinkPlan = {
  kind: 'unlink'
  name: string
  transactions: EnsPlannedTransaction[]
  current: AgentEnsRecordState
}

export async function planEnsUnlink(args: {
  client: EnsReadClient
  name: string
  signer: Address
  signerRole: string
  identityRegistryAddress: Address
  agentId: string
}): Promise<EnsUnlinkPlan> {
  const cleared = await clearOldRecordsTx({
    client: args.client,
    oldName: args.name,
    signer: args.signer,
    role: args.signerRole,
    keys: agentEnsRecordKeys(args.identityRegistryAddress, args.agentId),
    step: 'clear-records',
  })
  return {
    kind: 'unlink',
    name: normalizeEthDomain(args.name),
    transactions: cleared.tx ? [cleared.tx] : [],
    current: cleared.current,
  }
}

export type EnsRecordsPlan = {
  kind: 'records'
  name: string
  diffs: AgentRecordDiff[]
  transactions: EnsPlannedTransaction[]
}

// Writes every requested change in one resolver multicall. Keys whose value already
// matches are left alone, so nothing is sent when nothing changes.
export async function planEnsRecords(args: {
  client: EnsReadClient
  name: string
  set: Record<string, string>
  clear: readonly string[]
  signer: Address
  signerRole: string
}): Promise<EnsRecordsPlan> {
  const name = normalizeEthDomain(args.name)
  const control = await readNameControl(args.client, name)
  if (!control.exists) throw new EnsPlanRefusal(`${name} does not exist on ENS.`)
  if (!control.resolver) {
    throw new EnsPlanRefusal(`${name} has no resolver, so its records cannot be written.`, 'Set a resolver for it in the ENS app first. Nothing was sent.')
  }
  const desired: Record<string, string> = { ...args.set }
  for (const key of args.clear) desired[key] = ''
  const keys = Object.keys(desired)
  const current = await readTextRecords(args.client, control.resolver, control.node, keys)
  const diffs = keys.map(key => {
    const before = (current[key] ?? '').trim()
    const after = (desired[key] ?? '').trim()
    return { key, current: before, next: after, changed: before !== after }
  })
  const writes: Record<string, string> = {}
  for (const diff of diffs) if (diff.changed) writes[diff.key] = diff.next
  if (Object.keys(writes).length === 0) return { kind: 'records', name, diffs, transactions: [] }
  await requireControl(args.client, control, args.signer, args.signerRole)
  return {
    kind: 'records',
    name,
    diffs,
    transactions: [{
      step: 'update-records',
      name,
      to: control.resolver,
      data: multicall(textCalls(control.node, writes)),
      purpose: 'update-ens-records',
      description: `${name}: ${describeWrites(writes)}`,
      dependsOnPrevious: false,
    }],
  }
}

// Runs a planned transaction as an eth_call from the signer, without sending it.
export async function simulatePlannedTransaction(
  client: Pick<PublicClient, 'call'>,
  signer: Address,
  tx: EnsPlannedTransaction,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await client.call({ account: signer, to: tx.to, data: tx.data })
    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err)
    return { ok: false, reason: message.split('\n')[0] ?? message }
  }
}
