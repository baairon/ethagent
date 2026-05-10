import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  namehash,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'

export const ETH_REGISTRAR_CONTROLLER_MAINNET = '0x253553366Da8546fC250F225fe3d25d0C782303b' as Address
export const PUBLIC_RESOLVER_MAINNET = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63' as Address
export const MIN_COMMIT_AGE_SECONDS = 60
export const MAX_COMMIT_AGE_SECONDS = 86_400
export const ONE_YEAR_SECONDS = 31_557_600
export const REGISTER_VALUE_BUFFER_BIPS = 500n

const CONTROLLER_ABI = parseAbi([
  'function available(string name) view returns (bool)',
  'function rentPrice(string name, uint256 duration) view returns (uint256 base, uint256 premium)',
  'function commit(bytes32 commitment)',
  'function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable',
])

const RESOLVER_ABI = parseAbi([
  'function setAddr(bytes32 node, address a)',
])

export type RegistrableNameValidation =
  | { ok: true; label: string }
  | { ok: false; reason: 'too-short' | 'too-long' | 'invalid-characters' | 'leading-hyphen' | 'trailing-hyphen' | 'contains-dot'; detail: string }

export function validateRegistrableName(value: string): RegistrableNameValidation {
  const label = value.trim().toLowerCase()
  if (label.includes('.')) {
    return { ok: false, reason: 'contains-dot', detail: 'Enter only the label, not a full .eth name.' }
  }
  if (label.length < 3) {
    return { ok: false, reason: 'too-short', detail: 'Names must be at least 3 characters.' }
  }
  if (label.length > 64) {
    return { ok: false, reason: 'too-long', detail: 'Names must be 64 characters or fewer.' }
  }
  if (label.startsWith('-')) {
    return { ok: false, reason: 'leading-hyphen', detail: 'Names cannot start with a hyphen.' }
  }
  if (label.endsWith('-')) {
    return { ok: false, reason: 'trailing-hyphen', detail: 'Names cannot end with a hyphen.' }
  }
  if (!/^[a-z0-9-]+$/.test(label)) {
    return { ok: false, reason: 'invalid-characters', detail: 'Names use lowercase letters, numbers, and hyphens only.' }
  }
  return { ok: true, label }
}

type RentPrice = {
  base: bigint
  premium: bigint
  total: bigint
}

export type EnsRegistrationReadClient = Pick<PublicClient, 'readContract'>

export async function readRentPrice(
  client: EnsRegistrationReadClient,
  label: string,
  durationSeconds: bigint,
): Promise<RentPrice> {
  const result = await client.readContract({
    address: ETH_REGISTRAR_CONTROLLER_MAINNET,
    abi: CONTROLLER_ABI,
    functionName: 'rentPrice',
    args: [label, durationSeconds],
  }) as readonly [bigint, bigint]
  const [base, premium] = result
  return { base, premium, total: base + premium }
}

export async function readNameAvailable(
  client: EnsRegistrationReadClient,
  label: string,
): Promise<boolean> {
  return await client.readContract({
    address: ETH_REGISTRAR_CONTROLLER_MAINNET,
    abi: CONTROLLER_ABI,
    functionName: 'available',
    args: [label],
  }) as boolean
}

type CommitmentArgs = {
  label: string
  owner: Address
  durationSeconds: bigint
  secret: Hex
  resolver?: Address
  setAddrToOwner?: boolean
  reverseRecord?: boolean
  ownerControlledFuses?: number
}

type CommitmentBuild = {
  commitment: Hex
  resolver: Address
  data: Hex[]
  reverseRecord: boolean
  ownerControlledFuses: number
}

export function buildCommitment(args: CommitmentArgs): CommitmentBuild {
  const owner = getAddress(args.owner)
  const resolver = getAddress(args.resolver ?? PUBLIC_RESOLVER_MAINNET)
  const reverseRecord = args.reverseRecord ?? false
  const ownerControlledFuses = args.ownerControlledFuses ?? 0
  const data: Hex[] = []
  if (args.setAddrToOwner ?? true) {
    data.push(encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: 'setAddr',
      args: [namehash(`${args.label}.eth`), owner],
    }))
  }
  const commitment = keccak256(encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'bytes[]' },
      { type: 'bool' },
      { type: 'uint16' },
    ],
    [args.label, owner, args.durationSeconds, args.secret, resolver, data, reverseRecord, ownerControlledFuses],
  ))
  return { commitment, resolver, data, reverseRecord, ownerControlledFuses }
}

export function encodeCommitTransaction(commitment: Hex): { to: Address; data: Hex } {
  return {
    to: ETH_REGISTRAR_CONTROLLER_MAINNET,
    data: encodeFunctionData({
      abi: CONTROLLER_ABI,
      functionName: 'commit',
      args: [commitment],
    }),
  }
}

type RegisterTransactionArgs = {
  label: string
  owner: Address
  durationSeconds: bigint
  secret: Hex
  rentPrice: RentPrice
  resolver?: Address
  setAddrToOwner?: boolean
  reverseRecord?: boolean
  ownerControlledFuses?: number
}

export function encodeRegisterTransaction(args: RegisterTransactionArgs): { to: Address; data: Hex; value: Hex } {
  const owner = getAddress(args.owner)
  const built = buildCommitment({
    label: args.label,
    owner,
    durationSeconds: args.durationSeconds,
    secret: args.secret,
    ...(args.resolver !== undefined ? { resolver: args.resolver } : {}),
    ...(args.setAddrToOwner !== undefined ? { setAddrToOwner: args.setAddrToOwner } : {}),
    ...(args.reverseRecord !== undefined ? { reverseRecord: args.reverseRecord } : {}),
    ...(args.ownerControlledFuses !== undefined ? { ownerControlledFuses: args.ownerControlledFuses } : {}),
  })
  const data = encodeFunctionData({
    abi: CONTROLLER_ABI,
    functionName: 'register',
    args: [args.label, owner, args.durationSeconds, args.secret, built.resolver, built.data, built.reverseRecord, built.ownerControlledFuses],
  })
  const buffered = (args.rentPrice.total * (10000n + REGISTER_VALUE_BUFFER_BIPS)) / 10000n
  return {
    to: ETH_REGISTRAR_CONTROLLER_MAINNET,
    data,
    value: ('0x' + buffered.toString(16)) as Hex,
  }
}

export function generateRegistrationSecret(): Hex {
  const bytes = new Uint8Array(32)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let hex = '0x'
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex as Hex
}
