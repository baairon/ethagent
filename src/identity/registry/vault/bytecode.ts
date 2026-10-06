import { getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import { VAULT_RUNTIME_BYTECODE, VAULT_RUNTIME_BYTECODE_HASH } from './constants.js'
import { CURRENT_VAULT_BUILD, knownVaultBuilds, vaultBuildForHash, type VaultBuild } from './builds.js'
import { pacedConfirm, PacedTimeoutError, type PacedOptions } from '../../../net/paced.js'

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
      txHash
        ? 'Deployed contract bytecode does not match the expected Vault. The deploy transaction may have been intercepted.'
        : 'The contract at this address is not a known Vault build. It may have been replaced or intercepted.',
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

export type VaultCheckPacing = {
  // The chain's block time; the first pause before looking again.
  blockTimeMs?: number
  // The block that carried the deploy or deposit; reads wait until the endpoint has it.
  receiptBlock?: bigint
  getBlockNumber?: () => Promise<bigint>
  signal?: AbortSignal
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const DEFAULT_BLOCK_TIME_MS = 2_000

export function pacingOptions(pacing: VaultCheckPacing = {}): PacedOptions {
  return {
    blockTimeMs: pacing.blockTimeMs ?? DEFAULT_BLOCK_TIME_MS,
    ...(pacing.receiptBlock !== undefined && pacing.getBlockNumber
      ? { minBlock: { block: pacing.receiptBlock, getBlockNumber: pacing.getBlockNumber } }
      : {}),
    ...(pacing.signal ? { signal: pacing.signal } : {}),
    ...(pacing.pause ? { pause: pacing.pause } : {}),
  }
}

// Reads the code at latest (never at a block number: followers that lag answer "header
// not found" for a block they have not seen) until it is visible. Empty code and read
// errors are "not visible yet"; any non-empty code is the answer.
async function readVisibleBytecode(
  client: AssertVaultBytecodeClient,
  address: Address,
  pacing: VaultCheckPacing,
): Promise<Hex | undefined> {
  try {
    return await pacedConfirm<Hex>(
      `Vault code at ${address}`,
      async () => {
        const code = await client.getBytecode({ address })
        if (!code || code === '0x') return { done: false, observed: 'no code yet' }
        return { done: true, value: code }
      },
      pacingOptions(pacing),
    )
  } catch (err: unknown) {
    if (err instanceof PacedTimeoutError) return undefined
    throw err
  }
}

// Verifies the Vault's runtime code and returns its build. After a fresh deploy
// (txHash given) only the current build passes. An existing Vault may run any known
// build, since deployed Vaults never change. Unknown code throws.
export async function assertVaultBytecode(
  client: AssertVaultBytecodeClient,
  vaultAddress: Address,
  txHash?: Hex,
  pacing: VaultCheckPacing & { builds?: readonly VaultBuild[] } = {},
): Promise<VaultBuild> {
  const address = getAddress(vaultAddress)
  const code = await readVisibleBytecode(client, address, pacing)
  if (!code || code === '0x') {
    throw new VaultBytecodeMismatchError(address, null, 0, txHash)
  }
  const observedLength = (code.length - 2) / 2
  const observed = keccak256(code).toLowerCase() as Hex
  const allowed = txHash ? [CURRENT_VAULT_BUILD] : (pacing.builds ?? knownVaultBuilds())
  const build = vaultBuildForHash(observed, allowed)
  if (!build) {
    throw new VaultBytecodeMismatchError(address, observed, observedLength, txHash)
  }
  return build
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
