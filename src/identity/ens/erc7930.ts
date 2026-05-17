import type { Address } from 'viem'

const VERSION = 1
const CHAIN_TYPE_EIP155 = 0
const ADDRESS_BYTE_LENGTH = 20

export type InteroperableAddressArgs = {
  chainId: number
  address: Address
}

export function encodeInteroperableAddress(args: InteroperableAddressArgs): `0x${string}` {
  if (!Number.isInteger(args.chainId) || args.chainId <= 0) {
    throw new Error(`invalid chainId for ERC-7930: ${args.chainId}`)
  }
  const addressHex = args.address.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(addressHex)) {
    throw new Error(`invalid address for ERC-7930: ${args.address}`)
  }
  const chainRefBytes = minimalBigEndianBytes(BigInt(args.chainId))
  if (chainRefBytes.length > 0xff) {
    throw new Error(`chainId too large for ERC-7930 single-byte length prefix: ${args.chainId}`)
  }
  return `0x${uint16Hex(VERSION)}${uint16Hex(CHAIN_TYPE_EIP155)}${uint8Hex(chainRefBytes.length)}${bytesHex(chainRefBytes)}${uint8Hex(ADDRESS_BYTE_LENGTH)}${addressHex}` as `0x${string}`
}

function uint16Hex(n: number): string {
  return n.toString(16).padStart(4, '0')
}

function uint8Hex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

function minimalBigEndianBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array([0])
  const bytes: number[] = []
  let remaining = value
  while (remaining > 0n) {
    bytes.unshift(Number(remaining & 0xffn))
    remaining >>= 8n
  }
  return new Uint8Array(bytes)
}

function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
