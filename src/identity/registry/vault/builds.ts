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

// A build deployed before the source was committed (1,955 bytes), read from Vault
// 0x6bdC52c8e262c6D139e618260400614c2Bfe51d7 on Base, which holds token #45744. Its
// executable code was reproduced from a reconstructed source with solc 0.8.24 (only
// the metadata hash differs). The owner, operator, and refusal rules match the
// current build, with three differences:
// - no heldAgent() view;
// - no registry or token binding: it accepts any ERC-721 (AlreadyDeposited per
//   token, no UnexpectedToken);
// - no operator epoch: approvals survive a withdraw and apply to whoever deposits
//   the same token next.
export const PRE_RELEASE_VAULT_BUILD: VaultBuild = {
  id: 'pre-release',
  label: 'pre-release build, no heldAgent()',
  runtimeHash: '0xf8f2319752c7b0a6382ef0d233426d0bd605641e65300a4e1b2ece5479a64c13',
  hasHeldAgent: false,
}

export function knownVaultBuilds(): VaultBuild[] {
  return [CURRENT_VAULT_BUILD, FIRST_COMMITTED_VAULT_BUILD, PRE_RELEASE_VAULT_BUILD]
}

export function vaultBuildForHash(hash: Hex, builds: readonly VaultBuild[] = knownVaultBuilds()): VaultBuild | undefined {
  const wanted = hash.toLowerCase()
  return builds.find(build => build.runtimeHash.toLowerCase() === wanted)
}

export function vaultBuildForCode(code: Hex, builds: readonly VaultBuild[] = knownVaultBuilds()): VaultBuild | undefined {
  return vaultBuildForHash(keccak256(code), builds)
}
