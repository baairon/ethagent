import { stdout, stderr } from 'node:process'
import { loadConfig, saveConfig, type EthagentIdentity } from '../storage/config.js'
import { resolveRegistryForIdentity } from '../identity/registry/registryConfig.js'
import { continuityVaultStatus, continuityWorkingTreeStatus } from '../identity/continuity/storage/status.js'
import { listPublishedContinuitySnapshots } from '../identity/continuity/snapshots.js'
import { discoverOwnedAgentBackupByTokenId } from '../identity/registry/erc8004/discovery.js'
import { resolveUploadCredential, resolveValidatedPinataJwt } from '../identity/storage/pinataJwt.js'
import { resolveVaultAddress } from '../identity/manager/custody/transactions.js'
import { runOperatorWalletRebackup } from '../identity/manager/continuity/vault.js'
import { deriveAgentName } from '../identity/manager/shared/effects/profilePrep.js'
import { snapshotSaveWalletRole } from '../identity/manager/continuity/snapshot.js'
import { createLocalKeySignAndTransaction } from '../identity/wallet/localKeyWallet.js'
import type { EffectCallbacks } from '../identity/manager/shared/effects/types.js'
import type { Step } from '../identity/manager/reducer.js'
import { INVALID_OPERATOR_KEY_MESSAGE, OPERATOR_KEY_ENV, readOperatorKey } from './operatorKey.js'
import { pullHarnessSoulMemoryIntoVault } from './sync.js'
import { nothingToSave, saveJson, verifyPublished } from './saveVerify.js'

export type RunOperatorSaveDeps = {
  readOperatorKey: typeof readOperatorKey
  loadConfig: typeof loadConfig
  saveConfig: typeof saveConfig
  resolveValidatedPinataJwt: typeof resolveValidatedPinataJwt
  continuityVaultStatus: typeof continuityVaultStatus
  continuityWorkingTreeStatus: typeof continuityWorkingTreeStatus
  listPublishedContinuitySnapshots: typeof listPublishedContinuitySnapshots
  pullHarnessSoulMemoryIntoVault: typeof pullHarnessSoulMemoryIntoVault
  runOperatorWalletRebackup: typeof runOperatorWalletRebackup
  createSigner: typeof createLocalKeySignAndTransaction
  discoverOwnedAgentBackupByTokenId: typeof discoverOwnedAgentBackupByTokenId
}

export const defaultOperatorSaveDeps: RunOperatorSaveDeps = {
  readOperatorKey,
  loadConfig,
  saveConfig,
  resolveValidatedPinataJwt: resolveUploadCredential,
  continuityVaultStatus,
  continuityWorkingTreeStatus,
  listPublishedContinuitySnapshots,
  pullHarnessSoulMemoryIntoVault,
  runOperatorWalletRebackup,
  createSigner: createLocalKeySignAndTransaction,
  discoverOwnedAgentBackupByTokenId,
}

export async function runOperatorSave(args: string[] = [], deps: RunOperatorSaveDeps = defaultOperatorSaveDeps): Promise<number> {
  const json = args.includes('--json')
  const fail = (code: number, message: string): number => {
    if (json) stdout.write(saveJson({ ok: false, code, error: message }))
    else stderr.write(message + '\n')
    return code
  }

  const operatorKey = deps.readOperatorKey()
  if (!operatorKey.ok && operatorKey.reason === 'missing') {
    return fail(3, `No operator key available. The os-keychain skill injects ${OPERATOR_KEY_ENV}; run this via \`keychain operator-save\` (set the key first with \`keychain set ethagent/operator_key\`).`)
  }
  if (!operatorKey.ok) return fail(2, INVALID_OPERATOR_KEY_MESSAGE)
  const privateKey = operatorKey.key

  const config = await deps.loadConfig().catch(() => null)
  if (!config?.identity) return fail(1, 'No agent identity yet. Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')
  const identity = config.identity
  if (!identity.agentId) return fail(1, 'This identity has no agent token ID yet. Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')

  const registry = resolveRegistryForIdentity(identity, config)
  if (!registry) return fail(1, 'No agent registry configured for this identity. `ethagent restore <token-id>` records it.')

  const vault = await deps.continuityVaultStatus(identity).catch(() => ({ ready: false }))
  if (!vault.ready) return fail(1, 'Local continuity files are not restored. Bring them back with `ethagent restore --operator` before saving a snapshot.')

  const role = snapshotSaveWalletRole(identity, undefined)
  if (role !== 'operator') {
    return fail(1, `This agent is not set up for operator-key saves (current role: ${role}). The owner must save once and authorize this operator wallet with \`ethagent custody --add-operator\`.`)
  }

  const vaultAddress = resolveVaultAddress(identity, config.erc8004?.operatorVaults)
  if (!vaultAddress) {
    return fail(1, 'Advanced custody is configured but the operator vault address could not be resolved. `ethagent custody` shows where the token is held, and `ethagent custody --advanced` previews the repair.')
  }

  // Same as `save`: take in the tools' edits, and send nothing when nothing changed.
  await deps.pullHarnessSoulMemoryIntoVault(identity).catch(() => [])
  if (await nothingToSave(identity, deps)) {
    if (json) stdout.write(saveJson({ ok: true, skipped: true, reason: 'no-local-changes' }))
    else stdout.write('No local changes since the last snapshot; nothing to save.\n')
    return 0
  }

  let jwt: string | undefined
  try {
    jwt = await deps.resolveValidatedPinataJwt()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return fail(3, `The configured Pinata JWT is invalid or unreachable (${detail}). Replace it with \`ethagent storage --set\` (reads the JWT from stdin), then retry.`)
  }
  if (jwt === undefined) {
    return fail(3, 'No IPFS storage credential configured, so the snapshot cannot be pinned. Save one with `ethagent storage --set` (or export PINATA_JWT), then retry.')
  }

  let signAndTransaction
  try {
    signAndTransaction = deps.createSigner({ privateKey, rpcUrl: registry.rpcUrl, chainId: registry.chainId })
  } catch (err) {
    return fail(1, `Could not initialize the local-key signer: ${err instanceof Error ? err.message : String(err)}`)
  }

  let savedIdentity: EthagentIdentity | undefined
  const callbacks: EffectCallbacks = {
    onStep: () => {},
    onWalletReady: () => {},
    onIdentityComplete: async (nextIdentity: EthagentIdentity) => {
      await deps.saveConfig({ ...config, identity: nextIdentity })
      savedIdentity = nextIdentity
    },
  }

  const step: Extract<Step, { kind: 'rebackup-signing' }> = {
    kind: 'rebackup-signing',
    identity,
    registry,
    pinataJwt: jwt,
    walletPurpose: 'rotate-agent-uri-vault-operator',
    vaultAddress,
  }

  try {
    await deps.runOperatorWalletRebackup({
      step,
      callbacks,
      walletPurpose: 'rotate-agent-uri-vault-operator',
      deriveAgentName,
      signAndTransaction,
    })
  } catch (err) {
    return fail(1, `Operator save failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!savedIdentity) return fail(1, 'Operator save did not complete and no snapshot was recorded.')
  const ni = savedIdentity
  const cid = ni.backup?.cid ?? null
  const txHash = ni.backup?.txHash ?? null
  const agentUri = ni.agentUri ?? ni.backup?.agentUri ?? null
  const published = Boolean(txHash || ni.backup?.metadataCid)

  const verification = published
    ? await verifyPublished({ saved: ni, agentId: identity.agentId, registry, discover: deps.discoverOwnedAgentBackupByTokenId })
    : undefined

  if (json) {
    stdout.write(saveJson({ ok: true, published, ...(verification ? { verification } : {}), cid, txHash, agentUri }))
  } else if (published) {
    stdout.write('Snapshot published onchain via operator key (no wallet popup).\n')
    if (cid) stdout.write(`  CID:      ${cid}\n`)
    if (txHash) stdout.write(`  tx:       ${txHash}\n`)
    if (agentUri) stdout.write(`  agentURI: ${agentUri}\n`)
    if (verification === 'verified') stdout.write('  verified: onchain pointer resolves to this snapshot.\n')
    else if (verification === 'mismatch') stderr.write('  warning: the onchain pointer does not yet resolve to this snapshot (propagation delay?).\n')
  } else {
    stdout.write('Snapshot pinned locally, but the onchain pointer was not rotated. Retry, or publish it with the owner wallet through `ethagent save`.\n')
    if (cid) stdout.write(`  pinned CID: ${cid}\n`)
  }
  return published ? 0 : 4
}
