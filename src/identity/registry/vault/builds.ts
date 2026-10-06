import { keccak256, type Hex } from 'viem'
import { VAULT_RUNTIME_BYTECODE_HASH } from './constants.js'

// The Vault's constructor arguments live in storage, not in the code, so one runtime
// hash verifies every deployment of a build. Deployed builds are immutable: a build
// stays in this table for as long as any Vault running it may hold a token.
export type VaultBuild = {
  id: 'current' | 'first-committed' | 'pre-release'
  label: string
  runtimeHash: Hex
  hasHeldAgent: boolean
}

export const CURRENT_VAULT_BUILD: VaultBuild = {
  id: 'current',
  label: 'current build',
  runtimeHash: VAULT_RUNTIME_BYTECODE_HASH,
  hasHeldAgent: true,
}

// contracts/src/OperatorVault.sol at c216256, before the rename to Vault. Same
// behavior as the current build; only the contract name in the metadata differs.
export const FIRST_COMMITTED_VAULT_BUILD: VaultBuild = {
  id: 'first-committed',
  label: 'first committed build',
  runtimeHash: '0xfea7e898c15b1e72a5a54ec35bdad917dfed8ea3d4bfe078fafa3cf00784cde4',
  hasHeldAgent: true,
}

// A build deployed before the source was committed (1,955 bytes). It behaves like the
// current build except that it has no heldAgent() view. Its full runtime hash starts
// 0xf8f23197; it is filled in from a live read of a deployed Vault running it
// (`ethagent custody --json` prints `build.observedHash`).
export const PRE_RELEASE_VAULT_BUILD_HASH: Hex | undefined = undefined

export function knownVaultBuilds(): VaultBuild[] {
  const builds: VaultBuild[] = [CURRENT_VAULT_BUILD, FIRST_COMMITTED_VAULT_BUILD]
  if (PRE_RELEASE_VAULT_BUILD_HASH) {
    builds.push({
      id: 'pre-release',
      label: 'pre-release build, no heldAgent()',
      runtimeHash: PRE_RELEASE_VAULT_BUILD_HASH,
      hasHeldAgent: false,
    })
  }
  return builds
}

export function vaultBuildForHash(hash: Hex, builds: readonly VaultBuild[] = knownVaultBuilds()): VaultBuild | undefined {
  const wanted = hash.toLowerCase()
  return builds.find(build => build.runtimeHash.toLowerCase() === wanted)
}

export function vaultBuildForCode(code: Hex, builds: readonly VaultBuild[] = knownVaultBuilds()): VaultBuild | undefined {
  return vaultBuildForHash(keccak256(code), builds)
}
