import { getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import { VAULT_RUNTIME_BYTECODE, VAULT_RUNTIME_BYTECODE_HASH } from './constants.js'

export class VaultBytecodeMismatchError extends Error {
  readonly vaultAddress: Address
  readonly observedHash: Hex | null
  readonly observedLength: number
  readonly expectedHash: Hex
  readonly expectedLength: number
  readonly txHash?: Hex
  constructor(
    vaultAddress: Address,
    observedHash: Hex | null,
    observedLength: number,
    txHash?: Hex,
  ) {
    super(
      'Deployed contract bytecode does not match the expected Vault. The deploy transaction may have been intercepted.',
    )
    this.name = 'VaultBytecodeMismatchError'
    this.vaultAddress = vaultAddress
    this.observedHash = observedHash
    this.observedLength = observedLength
    this.expectedHash = VAULT_RUNTIME_BYTECODE_HASH
    this.expectedLength = (VAULT_RUNTIME_BYTECODE.length - 2) / 2
    if (txHash) this.txHash = txHash
  }
}

export type AssertVaultBytecodeClient = Pick<PublicClient, 'getBytecode'>

export const VAULT_POLL_MAX_ATTEMPTS = 5
export const VAULT_POLL_DELAY_MS = 1500
export function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readVaultBytecodeWithPoll(
  client: AssertVaultBytecodeClient,
  address: Address,
): Promise<Hex | undefined> {
  let lastErr: unknown
  let lastCode: Hex | undefined
  for (let attempt = 0; attempt < VAULT_POLL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delayMs(VAULT_POLL_DELAY_MS)
    try {
      const code = await client.getBytecode({ address })
      lastErr = undefined
      lastCode = code
      const isEmpty = !code || code === '0x'
      if (!isEmpty) return code
    } catch (err) {
      lastErr = err
      lastCode = undefined
    }
  }
  if (lastErr) throw lastErr
  return lastCode
}

export async function assertVaultBytecode(
  client: AssertVaultBytecodeClient,
  vaultAddress: Address,
  txHash?: Hex,
): Promise<void> {
  const address = getAddress(vaultAddress)
  const code = await readVaultBytecodeWithPoll(client, address)
  if (!code || code === '0x') {
    throw new VaultBytecodeMismatchError(address, null, 0, txHash)
  }
  const observedLength = (code.length - 2) / 2
  const observed = keccak256(code).toLowerCase() as Hex
  const expected = VAULT_RUNTIME_BYTECODE_HASH.toLowerCase() as Hex
  if (observed !== expected) {
    throw new VaultBytecodeMismatchError(address, observed, observedLength, txHash)
  }
}

function shortHash(hash: Hex): string {
  return `${hash.slice(0, 18)}...${hash.slice(-6)}`
}

export function formatVaultBytecodeMismatchDetail(
  err: VaultBytecodeMismatchError,
): string {
  const lines = [
    `Vault address:   ${err.vaultAddress}`,
  ]
  if (err.txHash) lines.push(`Deploy tx:       ${err.txHash}`)
  lines.push(`Expected hash:   ${shortHash(err.expectedHash)}`)
  if (err.observedHash) {
    lines.push(`Observed hash:   ${shortHash(err.observedHash)}`)
    lines.push(`Observed length: ${err.observedLength} bytes (expected ${err.expectedLength})`)
  } else {
    lines.push(`Observed code:   none. Address has no code.`)
  }
  return lines.join('\n')
}
