import { getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import { OPERATOR_VAULT_RUNTIME_BYTECODE, OPERATOR_VAULT_RUNTIME_BYTECODE_HASH } from './constants.js'

export class OperatorVaultBytecodeMismatchError extends Error {
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
      'Deployed contract bytecode does not match the expected operator delegation vault. The deploy transaction may have been intercepted.',
    )
    this.name = 'OperatorVaultBytecodeMismatchError'
    this.vaultAddress = vaultAddress
    this.observedHash = observedHash
    this.observedLength = observedLength
    this.expectedHash = OPERATOR_VAULT_RUNTIME_BYTECODE_HASH
    this.expectedLength = (OPERATOR_VAULT_RUNTIME_BYTECODE.length - 2) / 2
    if (txHash) this.txHash = txHash
  }
}

export type AssertVaultBytecodeClient = Pick<PublicClient, 'getBytecode'>

export const OPERATOR_VAULT_POLL_MAX_ATTEMPTS = 5
export const OPERATOR_VAULT_POLL_DELAY_MS = 1500
export function delayMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readVaultBytecodeWithPoll(
  client: AssertVaultBytecodeClient,
  address: Address,
): Promise<Hex | undefined> {
  let lastErr: unknown
  let lastCode: Hex | undefined
  for (let attempt = 0; attempt < OPERATOR_VAULT_POLL_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await delayMs(OPERATOR_VAULT_POLL_DELAY_MS)
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
    throw new OperatorVaultBytecodeMismatchError(address, null, 0, txHash)
  }
  const observedLength = (code.length - 2) / 2
  const observed = keccak256(code).toLowerCase() as Hex
  const expected = OPERATOR_VAULT_RUNTIME_BYTECODE_HASH.toLowerCase() as Hex
  if (observed !== expected) {
    throw new OperatorVaultBytecodeMismatchError(address, observed, observedLength, txHash)
  }
}

function shortHash(hash: Hex): string {
  return `${hash.slice(0, 18)}...${hash.slice(-6)}`
}

export function formatOperatorVaultBytecodeMismatchDetail(
  err: OperatorVaultBytecodeMismatchError,
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
