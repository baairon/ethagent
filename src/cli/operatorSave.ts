import { stdout, stderr } from 'node:process'
import { loadConfig, saveConfig, type EthagentIdentity } from '../storage/config.js'
import { resolveRegistryForIdentity } from '../identity/registry/registryConfig.js'
import { continuityVaultStatus } from '../identity/continuity/storage/status.js'
import { resolveValidatedPinataJwt } from '../identity/storage/pinataJwt.js'
import { resolveVaultAddress } from '../identity/manager/custody/transactions.js'
import { runOperatorWalletRebackup } from '../identity/manager/continuity/vault.js'
import { deriveAgentName } from '../identity/manager/shared/effects/profilePrep.js'
import { snapshotSaveWalletRole } from '../identity/manager/continuity/snapshot.js'
import { createLocalKeySignAndTransaction } from '../identity/wallet/localKeyWallet.js'
import type { EffectCallbacks } from '../identity/manager/shared/effects/types.js'
import type { Step } from '../identity/manager/reducer.js'
import { INVALID_OPERATOR_KEY_MESSAGE, OPERATOR_KEY_ENV, readOperatorKey } from './operatorKey.js'

export async function runOperatorSave(args: string[] = []): Promise<number> {
  const json = args.includes('--json')
  const fail = (code: number, message: string): number => {
    if (json) stdout.write(JSON.stringify({ ok: false, code, error: message }) + '\n')
    else stderr.write(message + '\n')
    return code
  }

  const operatorKey = readOperatorKey()
  if (!operatorKey.ok && operatorKey.reason === 'missing') {
    return fail(3, `No operator key available. The os-keychain skill injects ${OPERATOR_KEY_ENV}; run this via \`keychain operator-save\` (set the key first with \`keychain set ethagent/operator_key\`).`)
  }
  if (!operatorKey.ok) return fail(2, INVALID_OPERATOR_KEY_MESSAGE)
  const privateKey = operatorKey.key

  const config = await loadConfig().catch(() => null)
  if (!config?.identity) return fail(1, 'No agent identity yet. Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')
  const identity = config.identity
  if (!identity.agentId) return fail(1, 'This identity has no agent token ID yet. Mint one with `ethagent create`, or bring one back with `ethagent restore <token-id>`.')

  const registry = resolveRegistryForIdentity(identity, config)
  if (!registry) return fail(1, 'No agent registry configured for this identity. `ethagent restore <token-id>` records it.')

  const vault = await continuityVaultStatus(identity).catch(() => ({ ready: false }))
  if (!vault.ready) return fail(1, 'Local continuity files are not restored. Bring them back with `ethagent restore --operator` before saving a snapshot.')

  const role = snapshotSaveWalletRole(identity, undefined)
  if (role !== 'operator') {
    return fail(1, `This agent is not set up for operator-key saves (current role: ${role}). The owner must save once and authorize this operator wallet with \`ethagent custody --add-operator\`.`)
  }

  const vaultAddress = resolveVaultAddress(identity, config.erc8004?.operatorVaults)
  if (!vaultAddress) {
    return fail(1, 'Advanced custody is configured but the operator vault address could not be resolved. `ethagent custody` shows where the token is held, and `ethagent custody --advanced` previews the repair.')
  }

  let jwt: string | undefined
  try {
    jwt = await resolveValidatedPinataJwt()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return fail(3, `The configured Pinata JWT is invalid or unreachable (${detail}). Replace it with \`ethagent storage --set\` (reads the JWT from stdin), then retry.`)
  }
  if (!jwt) {
    return fail(3, 'No IPFS storage credential configured, so the snapshot cannot be pinned. Save one with `ethagent storage --set` (or export PINATA_JWT), then retry.')
  }

  let signAndTransaction
  try {
    signAndTransaction = createLocalKeySignAndTransaction({ privateKey, rpcUrl: registry.rpcUrl, chainId: registry.chainId })
  } catch (err) {
    return fail(1, `Could not initialize the local-key signer: ${err instanceof Error ? err.message : String(err)}`)
  }

  let savedIdentity: EthagentIdentity | undefined
  const callbacks: EffectCallbacks = {
    onStep: () => {},
    onWalletReady: () => {},
    onIdentityComplete: async (nextIdentity: EthagentIdentity) => {
      await saveConfig({ ...config, identity: nextIdentity })
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
    await runOperatorWalletRebackup({
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

  if (json) {
    stdout.write(JSON.stringify({ ok: true, published, cid, txHash, agentUri }) + '\n')
  } else if (published) {
    stdout.write('Snapshot published onchain via operator key (no wallet popup).\n')
    if (cid) stdout.write(`  CID:      ${cid}\n`)
    if (txHash) stdout.write(`  tx:       ${txHash}\n`)
    if (agentUri) stdout.write(`  agentURI: ${agentUri}\n`)
  } else {
    stdout.write('Snapshot pinned locally, but the onchain pointer was not rotated. Retry, or publish it with the owner wallet through `ethagent save`.\n')
    if (cid) stdout.write(`  pinned CID: ${cid}\n`)
  }
  return published ? 0 : 4
}
