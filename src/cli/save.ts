import { stdout, stderr } from 'node:process'
import { loadConfig, saveConfig, type EthagentConfig } from '../storage/config.js'
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

// Headless Save Snapshot: encrypt soul/memory/skills, pin to IPFS, and rotate the
// ERC-8004 onchain pointer. The agent can trigger this; the human still approves the
// signature and transaction in the browser wallet tab. The whole pipeline is reused
// from the ink TUI (`runRebackupSigning`) with a print-only callbacks shim.
//
// Exit codes: 0 success · 1 no identity / not restored / generic runtime error ·
// 2 usage (unknown option) · 3 credential or wallet problem the human must resolve
// (no JWT, invalid JWT, or wallet cancelled/timed out).

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

  // Only proceed when the working tree actually differs from the last published
  // snapshot. If it is already up to date, do nothing: no wallet, no transaction, no
  // gas. We only block on the confirmed-equal state ('published'); first saves
  // ('not-published') and undeterminable cases still go through.
  let publishState: string | undefined
  try {
    const [latest] = await deps.listPublishedContinuitySnapshots(identity, 1)
    const tree = await deps.continuityWorkingTreeStatus(identity, latest)
    publishState = tree.publishState
  } catch {
    publishState = undefined
  }
  if (publishState === 'published') {
    if (json) stdout.write(JSON.stringify({ ok: true, skipped: true, reason: 'no-local-changes' }) + '\n')
    else stdout.write('No local changes since the last snapshot; nothing to save.\n')
    return 0
  }

  // JWT is resolved and validated BEFORE opening the wallet, so we never ask for a
  // signature on a snapshot that then cannot be pinned.
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
  const callbacks: EffectCallbacks = {
    onStep: () => {},
    onWalletReady: ready => {
      if (!ready) return
      const sink = json ? stderr : stdout
      sink.write(`Approve this snapshot in your browser wallet tab: ${ready.url}\n`)
      sink.write('Connect your wallet, sign one message, and approve one transaction (up to ~5 minutes)...\n')
      if (!noOpen) deps.openExternalUrl(ready.url)
    },
    onIdentityComplete: async nextIdentity => {
      await deps.saveConfig({ ...activeConfig, identity: nextIdentity })
      completed = true
      if (json) {
        stdout.write(JSON.stringify({
          ok: true,
          cid: nextIdentity.backup?.cid ?? null,
          txHash: nextIdentity.backup?.txHash ?? null,
          agentUri: nextIdentity.agentUri ?? null,
        }) + '\n')
      } else {
        stdout.write('Snapshot saved.\n')
        if (nextIdentity.backup?.cid) stdout.write(`  CID:      ${nextIdentity.backup.cid}\n`)
        if (nextIdentity.backup?.txHash) stdout.write(`  tx:       ${nextIdentity.backup.txHash}\n`)
        if (nextIdentity.agentUri) stdout.write(`  agentURI: ${nextIdentity.agentUri}\n`)
      }
    },
  }

  const step: Extract<Step, { kind: 'rebackup-signing' }> = {
    kind: 'rebackup-signing',
    identity,
    registry,
    pinataJwt: jwt,
    returnTo: { kind: 'menu' },
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

  if (!completed) {
    return fail(1, 'Save did not complete and no snapshot was recorded. Retry `ethagent save`.')
  }
  return 0
}
