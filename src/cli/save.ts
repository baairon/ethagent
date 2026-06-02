import { stdout, stderr } from 'node:process'
import { loadConfig, saveConfig, type EthagentConfig, type EthagentIdentity } from '../storage/config.js'
import { resolveRegistryForIdentity } from '../identity/registry/registryConfig.js'
import { continuityVaultStatus, continuityWorkingTreeStatus } from '../identity/continuity/storage/status.js'
import { listPublishedContinuitySnapshots } from '../identity/continuity/snapshots.js'
import { resolveValidatedPinataJwt } from '../identity/storage/pinataJwt.js'
import { runRebackupSigning } from '../identity/manager/continuity/effects.js'
import type { EffectCallbacks } from '../identity/manager/shared/effects/types.js'
import { isWalletCancelled } from '../identity/manager/shared/utils.js'
import type { Step } from '../identity/manager/reducer.js'
import { openExternalUrl } from '../utils/openExternal.js'
import { pullHarnessSoulMemoryIntoVault } from './sync.js'
import { discoverOwnedAgentBackupByTokenId } from '../identity/registry/erc8004/discovery.js'
import { DEFAULT_IPFS_API_URL } from '../identity/storage/ipfs.js'
import { resolveVaultAddress } from '../identity/manager/custody/transactions.js'
import { hasPendingPublish } from '../identity/manager/continuity/state.js'
import { getAddress } from 'viem'

export type RunSaveDeps = {
  loadConfig: typeof loadConfig
  saveConfig: typeof saveConfig
  resolveValidatedPinataJwt: typeof resolveValidatedPinataJwt
  continuityVaultStatus: typeof continuityVaultStatus
  continuityWorkingTreeStatus: typeof continuityWorkingTreeStatus
  listPublishedContinuitySnapshots: typeof listPublishedContinuitySnapshots
  runRebackupSigning: typeof runRebackupSigning
  openExternalUrl: typeof openExternalUrl
  pullHarnessSoulMemoryIntoVault: typeof pullHarnessSoulMemoryIntoVault
  discoverOwnedAgentBackupByTokenId: typeof discoverOwnedAgentBackupByTokenId
}

const defaultDeps: RunSaveDeps = {
  loadConfig,
  saveConfig,
  resolveValidatedPinataJwt,
  continuityVaultStatus,
  continuityWorkingTreeStatus,
  listPublishedContinuitySnapshots,
  runRebackupSigning,
  openExternalUrl,
  pullHarnessSoulMemoryIntoVault,
  discoverOwnedAgentBackupByTokenId,
}

export async function runSave(args: string[] = [], deps: RunSaveDeps = defaultDeps): Promise<number> {
  const json = args.includes('--json')
  const noOpen = args.includes('--no-open')
  const unknown = args.filter(a => a !== '--json' && a !== '--no-open')
  if (unknown.length > 0) {
    stderr.write(`unknown save option: ${unknown[0]}\nusage: ethagent save [--json] [--no-open]\n`)
    return 2
  }

  const fail = (code: number, message: string): number => {
    if (json) stdout.write(JSON.stringify({ ok: false, code, error: message }) + '\n')
    else stderr.write(message + '\n')
    return code
  }

  const config = await deps.loadConfig().catch(() => null)
  if (!config?.identity) {
    return fail(1, 'No agent identity yet. Run `npx ethagent` to create or link one.')
  }
  const activeConfig: EthagentConfig = config
  const identity = config.identity

  if (!identity.agentId) {
    return fail(1, 'This identity has no agent token ID yet. Create or restore it with `npx ethagent` first.')
  }

  const registry = resolveRegistryForIdentity(identity, activeConfig)
  if (!registry) {
    return fail(1, 'No agent registry configured for this identity. Run `npx ethagent` to set it up.')
  }

  const vault = await deps.continuityVaultStatus(identity).catch(() => ({ ready: false }))
  if (!vault.ready) {
    return fail(1, 'Local continuity files are not restored. Run `npx ethagent` and restore this identity before saving a snapshot.')
  }

  await deps.pullHarnessSoulMemoryIntoVault(identity).catch(() => [])

  let publishState: string | undefined
  try {
    const [latest] = await deps.listPublishedContinuitySnapshots(identity, 1)
    const tree = await deps.continuityWorkingTreeStatus(identity, latest)
    publishState = tree.publishState
  } catch {
    publishState = undefined
  }
  if (publishState === 'published' && !hasPendingPublish(identity)) {
    if (json) stdout.write(JSON.stringify({ ok: true, skipped: true, reason: 'no-local-changes' }) + '\n')
    else stdout.write('No local changes since the last snapshot; nothing to save.\n')
    return 0
  }

  let jwt: string | undefined
  try {
    jwt = await deps.resolveValidatedPinataJwt()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return fail(3, `The configured Pinata JWT is invalid or unreachable (${detail}). The wallet was not opened. Update it via \`npx ethagent\` -> IPFS Storage, then retry \`ethagent save\`.`)
  }
  if (!jwt) {
    return fail(3, 'No IPFS storage credential configured, so the snapshot cannot be pinned and the wallet was not opened. Run `npx ethagent` once and set up IPFS Storage (or export PINATA_JWT in this shell), then retry `ethagent save`.')
  }

  let completed = false
  let savedIdentity: EthagentIdentity | undefined
  let completionMessage = ''
  const callbacks: EffectCallbacks = {
    onStep: () => {},
    onWalletReady: ready => {
      if (!ready) return
      const sink = json ? stderr : stdout
      sink.write(`Approve this snapshot in your browser wallet tab: ${ready.url}\n`)
      sink.write('Connect your wallet, sign one message, and approve one transaction (up to ~5 minutes)...\n')
      if (!noOpen) deps.openExternalUrl(ready.url)
    },
    onIdentityComplete: async (nextIdentity, message) => {
      await deps.saveConfig({ ...activeConfig, identity: nextIdentity })
      completed = true
      savedIdentity = nextIdentity
      completionMessage = message
    },
  }

  const vaultAddress = resolveVaultAddress(identity, activeConfig.erc8004?.operatorVaults)
  const step: Extract<Step, { kind: 'rebackup-signing' }> = {
    kind: 'rebackup-signing',
    identity,
    registry,
    pinataJwt: jwt,
    returnTo: { kind: 'menu' },
    ...(vaultAddress ? { vaultAddress } : {}),
  }

  try {
    await deps.runRebackupSigning(step, callbacks)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isWalletCancelled(err) || /timed out/i.test(message)) {
      return fail(3, 'Wallet approval was cancelled or timed out. No snapshot was saved. Retry `ethagent save` when ready.')
    }
    return fail(1, `Save failed: ${message}`)
  }

  if (!completed || !savedIdentity) {
    return fail(1, 'Save did not complete and no snapshot was recorded. Retry `ethagent save`.')
  }

  const ni = savedIdentity
  const cid = ni.backup?.cid ?? null
  const published = Boolean(ni.backup?.txHash || ni.backup?.metadataCid)

  if (published) {
    let verification: 'verified' | 'mismatch' | 'unknown' = 'unknown'
    try {
      const candidate = await deps.discoverOwnedAgentBackupByTokenId({
        ...registry,
        ownerHandle: getAddress(ni.ownerAddress ?? ni.address),
        tokenId: BigInt(identity.agentId),
        ipfsApiUrl: ni.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
      })
      const onchainCid = candidate.backup?.cid ?? null
      verification = onchainCid ? (onchainCid === cid ? 'verified' : 'mismatch') : 'unknown'
    } catch {
      verification = 'unknown'
    }
    if (json) {
      stdout.write(JSON.stringify({ ok: true, published: true, verification, cid, txHash: ni.backup?.txHash ?? null, agentUri: ni.agentUri ?? null }) + '\n')
    } else {
      stdout.write('Snapshot published onchain.\n')
      if (cid) stdout.write(`  CID:      ${cid}\n`)
      if (ni.backup?.txHash) stdout.write(`  tx:       ${ni.backup.txHash}\n`)
      if (ni.agentUri) stdout.write(`  agentURI: ${ni.agentUri}\n`)
      if (verification === 'verified') stdout.write('  verified: onchain pointer resolves to this snapshot.\n')
      else if (verification === 'mismatch') stderr.write('  warning: the onchain pointer does not yet resolve to this snapshot (propagation delay?).\n')
    }
    return 0
  }

  const detail = completionMessage || 'Snapshot saved locally. The owner wallet still needs to publish to rotate the onchain pointer.'
  if (json) {
    stdout.write(JSON.stringify({ ok: true, published: false, pending: 'owner-publish', cid, message: detail }) + '\n')
  } else {
    stdout.write(`${detail}\n`)
    if (cid) stdout.write(`  pinned CID: ${cid}\n`)
    stderr.write('NOT published onchain yet: this snapshot will not survive a reset/restore until the owner publishes it.\n')
    stderr.write('Publish with the owner wallet via `npx ethagent` -> Save Snapshot (it shows a "publish" step).\n')
  }
  return 4
}
