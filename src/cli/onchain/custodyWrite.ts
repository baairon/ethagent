import { getAddress, isAddress, type Address } from 'viem'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import { createErc8004PublicClient, type Erc8004RegistryConfig } from '../../identity/registry/erc8004.js'
import { ERC8004_ABI } from '../../identity/registry/erc8004/abi.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import {
  assertVaultBytecode,
  confirmAgentInVault,
  discoverPriorVaultFromTokenOwner,
  isAgentInVault,
  readMetadataOperators,
} from '../../identity/registry/vault.js'
import {
  assertVaultCanAcceptAgent,
  findReusableDeployedVault,
  receiptPacing,
  recordDeployedVault,
  resolveVaultAddress,
  runVaultDeployTransaction,
  runVaultDepositTransaction,
  runVaultUnwrapTransaction,
  VaultRefusedDepositError,
} from '../../identity/manager/custody/transactions.js'
import { humanOwnerAddress, localOperatorAddresses } from '../../identity/manager/custody/helpers.js'
import { readCustodyMode } from '../../identity/manager/custody/state.js'
import { runRebackupSigningInSession } from '../../identity/manager/continuity/effects.js'
import { revokeVaultOperatorsBeforeWithdraw } from '../../identity/manager/shared/effects/sync.js'
import {
  activateOperatorUpdates,
  addOperatorUpdates,
  operatorAccessContext,
  operatorProofChallenge,
  operatorRecordFromProof,
  removeOperatorUpdates,
} from '../../identity/manager/shared/operatorAccess.js'
import type { ProfileUpdates, Step } from '../../identity/manager/reducer.js'
import { continuityVaultStatus } from '../../identity/continuity/storage/status.js'
import { resolveValidatedPinataJwt } from '../../identity/storage/pinataJwt.js'
import { signMessage } from '../../identity/crypto/eth.js'
import { openBrowserWalletSession, type BrowserWalletReady, type BrowserWalletSession } from '../../identity/wallet/browserWallet.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import { pullHarnessSoulMemoryIntoVault } from '../sync.js'
import { emitJson, HistoryError, type HistoryDeps } from '../history/shared.js'
import { quietCallbacks, requireOperatorKey, requireStorage, walletCancelled, WalletTab } from './shared.js'

export type CustodyWrite =
  | { kind: 'advanced' }
  | { kind: 'simple' }
  | { kind: 'add-operator'; address?: Address }
  | { kind: 'remove-operator'; address: Address }
  | { kind: 'activate-operator'; address: Address }

export type CustodyWriteSeams = {
  client: (registry: Erc8004RegistryConfig) => Pick<ReturnType<typeof createErc8004PublicClient>, 'readContract' | 'getBytecode' | 'simulateContract' | 'getBlockNumber'>
  priorVault: typeof discoverPriorVaultFromTokenOwner
  reusableVault: typeof findReusableDeployedVault
  deploy: typeof runVaultDeployTransaction
  deposit: typeof runVaultDepositTransaction
  confirmDeposit: typeof confirmAgentInVault
  unwrap: typeof runVaultUnwrapTransaction
  revoke: typeof revokeVaultOperatorsBeforeWithdraw
  recordVault: typeof recordDeployedVault
  publish: typeof runRebackupSigningInSession
  resolveJwt: typeof resolveValidatedPinataJwt
  vaultStatus: typeof continuityVaultStatus
  pullHarness: typeof pullHarnessSoulMemoryIntoVault
  openSession: (onReady: (ready: BrowserWalletReady) => void) => Promise<BrowserWalletSession>
  openExternal: (url: string) => void
  saveConfig: (config: EthagentConfig) => Promise<void>
}

export const defaultCustodyWriteSeams: CustodyWriteSeams = {
  client: registry => createErc8004PublicClient(registry),
  priorVault: discoverPriorVaultFromTokenOwner,
  reusableVault: findReusableDeployedVault,
  deploy: runVaultDeployTransaction,
  deposit: runVaultDepositTransaction,
  confirmDeposit: confirmAgentInVault,
  unwrap: runVaultUnwrapTransaction,
  revoke: revokeVaultOperatorsBeforeWithdraw,
  recordVault: recordDeployedVault,
  publish: runRebackupSigningInSession,
  resolveJwt: resolveValidatedPinataJwt,
  vaultStatus: continuityVaultStatus,
  pullHarness: pullHarnessSoulMemoryIntoVault,
  openSession: onReady => openBrowserWalletSession({ title: 'ethagent custody', onReady }),
  openExternal: url => openExternalUrl(url),
  saveConfig,
}

type PlannedStep = { step: string; description: string; signer: string; simulation?: string }

export function parseCustodyWrite(values: Record<string, unknown>, positionals: string[]): CustodyWrite | null {
  const chosen = ['advanced', 'simple', 'add-operator', 'remove-operator', 'activate-operator'].filter(flag => values[flag] !== undefined && values[flag] !== false)
  if (chosen.length === 0) {
    if (positionals.length > 0) throw new HistoryError(2, `unexpected argument: ${positionals[0]}`)
    return null
  }
  if (chosen.length > 1) throw new HistoryError(2, `choose one of ${chosen.map(flag => `--${flag}`).join(', ')}`)
  if (values.verify) throw new HistoryError(2, '--verify is read-only; run it on its own')
  const flag = chosen[0]!
  const address = (raw: unknown, name: string): Address => {
    if (typeof raw !== 'string' || !isAddress(raw, { strict: false })) throw new HistoryError(2, `--${name} expects an address`)
    return getAddress(raw)
  }
  if (flag === 'advanced' || flag === 'simple') {
    if (positionals.length > 0) throw new HistoryError(2, `unexpected argument: ${positionals[0]}`)
    return { kind: flag }
  }
  if (flag === 'add-operator') {
    if (positionals.length > 1) throw new HistoryError(2, `unexpected argument: ${positionals[1]}`)
    return positionals[0] ? { kind: 'add-operator', address: address(positionals[0], 'add-operator') } : { kind: 'add-operator' }
  }
  return { kind: flag as 'remove-operator' | 'activate-operator', address: address(values[flag], flag) }
}

// Runs a custody change: plans it from chain state (so a re-run resumes where the
// last one stopped), previews it, and with --yes runs every wallet prompt in one tab.
export async function runCustodyWrite(
  write: CustodyWrite,
  flags: { yes: boolean; json: boolean; noOpen: boolean; operator: boolean },
  deps: HistoryDeps,
  config: EthagentConfig,
  identity: EthagentIdentity,
  seams: CustodyWriteSeams,
  // A caller that already has a wallet tab open (create --advanced) passes it, and
  // reports the outcome itself.
  embed?: { tab: WalletTab; onResult: (result: Record<string, unknown>) => void },
): Promise<number> {
  if (!identity.agentId) throw new HistoryError(1, 'This identity has no agent token ID yet.')
  const registry = resolveRegistryForIdentity(identity, config)
  if (!registry) throw new HistoryError(1, 'No agent registry is configured for this identity.')
  const agentId = BigInt(identity.agentId)
  const owner = getAddress(humanOwnerAddress(identity))
  const mode = readCustodyMode(identity.state as Record<string, unknown> | undefined) ?? 'simple'
  const client = seams.client(registry)
  const operatorKey = flags.operator ? requireOperatorKey(deps, 'custody') : undefined
  if (operatorKey && write.kind !== 'add-operator') {
    throw new HistoryError(2, '--operator only applies to --add-operator, where the operator key signs its own proof')
  }

  const steps: PlannedStep[] = []
  let profileUpdates: ProfileUpdates | null = null
  let vaultAddress: Address | undefined = resolveVaultAddress(identity, config.erc8004?.operatorVaults)
  let needDeploy = false
  let needDeposit = false
  let needUnwrap = false
  let revokeCandidates: Address[] = []
  let addProof: { challenge: (account: Address) => string; ctx: ReturnType<typeof operatorAccessContext> } | null = null

  if (write.kind === 'advanced') {
    const tokenOwner = getAddress(await client.readContract({
      address: registry.identityRegistryAddress, abi: ERC8004_ABI, functionName: 'ownerOf', args: [agentId],
    }) as Address)
    if (!vaultAddress) {
      const prior = await seams.priorVault({ client, registry: registry.identityRegistryAddress, agentId, expectedOwner: owner })
      if (prior.found) vaultAddress = prior.vaultAddress
    }
    let inVault = false
    if (vaultAddress) {
      const status = await isAgentInVault({ client, vaultAddress, registry: registry.identityRegistryAddress, agentId })
      inVault = status.inVault
      if (status.inVault && status.ownerAddress?.toLowerCase() !== owner.toLowerCase()) {
        throw new HistoryError(1, `Vault ${vaultAddress} holds token #${agentId.toString()} for ${status.ownerAddress}, not the owner wallet ${owner}.`, 'Only that depositor can withdraw it.')
      }
    }
    if (!inVault && tokenOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new HistoryError(1, `Token #${agentId.toString()} is held by ${tokenOwner}, not the owner wallet ${owner}.`)
    }
    if (mode === 'advanced' && inVault) {
      return done(deps, flags.json, 'Already in Advanced custody: the Vault holds the token.')
    }
    if (!vaultAddress && !inVault) {
      const reusable = await seams.reusableVault({ registry, agentId, owner })
      if (reusable) vaultAddress = reusable
    }
    if (!vaultAddress) {
      needDeploy = true
      steps.push({ step: 'deploy', description: 'deploy a Vault bound to this token', signer: `owner wallet ${owner}` })
    }
    if (!inVault) {
      needDeposit = true
      let simulation: string | undefined
      if (vaultAddress) {
        try {
          const build = await assertVaultBytecode(client, vaultAddress)
          await assertVaultCanAcceptAgent({ registry, vaultAddress, agentId, build, owner, client })
          simulation = 'would succeed'
        } catch (err: unknown) {
          if (!(err instanceof VaultRefusedDepositError) && !(err instanceof Error && err.name === 'VaultBytecodeMismatchError')) throw err
          simulation = `refused: ${err.message}`
        }
      }
      steps.push({ step: 'deposit', description: `deposit token #${agentId.toString()} into ${vaultAddress ?? 'the new Vault'}`, signer: `owner wallet ${owner}`, ...(simulation ? { simulation } : {}) })
    }
    profileUpdates = { custodyMode: 'advanced', ownerAddress: owner, bumpRestoreAccessEpoch: true, custodyPhase: 'switch-advanced' }
    steps.push({ step: 'save', description: 'publish Advanced custody, through the Vault', signer: `owner wallet ${owner}` })
  } else if (write.kind === 'simple') {
    if (vaultAddress) {
      const status = await isAgentInVault({ client, vaultAddress, registry: registry.identityRegistryAddress, agentId })
      if (status.inVault) {
        if (status.ownerAddress?.toLowerCase() !== owner.toLowerCase()) {
          throw new HistoryError(1, `Vault ${vaultAddress} holds token #${agentId.toString()} for ${status.ownerAddress}, not the owner wallet ${owner}.`, 'Only that depositor can withdraw it.')
        }
        const approvals = await readMetadataOperators({
          client, vaultAddress, registry: registry.identityRegistryAddress, agentId, candidates: localOperatorAddresses(identity),
        })
        revokeCandidates = Object.entries(approvals).filter(([, on]) => on).map(([address]) => getAddress(address))
        for (const operator of revokeCandidates) {
          steps.push({ step: 'revoke', description: `revoke operator ${operator} on the Vault`, signer: `owner wallet ${owner}` })
        }
        needUnwrap = true
        steps.push({ step: 'withdraw', description: `withdraw token #${agentId.toString()} from ${vaultAddress} to ${owner}`, signer: `owner wallet ${owner}` })
      }
    }
    if (mode === 'simple' && !needUnwrap) return done(deps, flags.json, 'Already in Simple custody.')
    profileUpdates = {
      custodyMode: 'simple',
      bumpRestoreAccessEpoch: true,
      custodyPhase: 'switch-simple',
      approvedOperatorWallets: [],
      activeOperatorAddress: '',
      operatorVaultAddress: '',
    }
    steps.push({ step: 'save', description: 'publish Simple custody', signer: `owner wallet ${owner}` })
  } else {
    if (mode !== 'advanced') throw new HistoryError(1, 'Operators need Advanced custody.', 'Switch first with `ethagent custody --advanced`.')
    let ctx: ReturnType<typeof operatorAccessContext>
    try {
      ctx = operatorAccessContext(identity, registry)
    } catch (err: unknown) {
      throw new HistoryError(1, err instanceof Error ? err.message : String(err))
    }
    if (write.kind === 'add-operator') {
      const target = operatorKey ? operatorKey.address : write.address
      if (operatorKey && write.address && write.address.toLowerCase() !== operatorKey.address.toLowerCase()) {
        throw new HistoryError(2, `--operator adds the injected key ${operatorKey.address}, not ${write.address}`)
      }
      if (target && target.toLowerCase() === owner.toLowerCase()) throw new HistoryError(1, 'The operator wallet must differ from the owner wallet.')
      if (target && ctx.records.some(record => record.address.toLowerCase() === target.toLowerCase())) {
        return done(deps, flags.json, `${target} is already an approved operator.`)
      }
      addProof = { ctx, challenge: account => operatorProofChallenge(ctx, account) }
      steps.push({
        step: 'operator-proof',
        description: `the operator ${target ?? 'wallet that connects'} signs its restore-access proof`,
        signer: operatorKey ? `operator key ${operatorKey.address}, locally` : `operator wallet ${target ?? '(any)'}`,
      })
    } else if (write.kind === 'remove-operator') {
      try {
        profileUpdates = removeOperatorUpdates(ctx, write.address)
      } catch (err: unknown) {
        throw new HistoryError(1, err instanceof Error ? err.message : String(err))
      }
    } else {
      try {
        profileUpdates = activateOperatorUpdates(ctx, write.address)
      } catch (err: unknown) {
        throw new HistoryError(1, err instanceof Error ? err.message : String(err))
      }
      if (ctx.activeOperatorAddress?.toLowerCase() === write.address.toLowerCase()) {
        return done(deps, flags.json, `${write.address} is already the active operator.`)
      }
    }
    steps.push({ step: 'save', description: 'publish the operator list and sync the Vault approvals', signer: `owner wallet ${owner}` })
  }

  const summary = { action: write.kind, owner, vault: vaultAddress ?? null, steps }
  if (!flags.yes) {
    if (flags.json) {
      await emitJson(deps.io, { applied: false, ...summary })
    } else {
      const lines = ['Preview (nothing signed or sent).']
      steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step.description} [${step.signer}]${step.simulation ? ` (${step.simulation})` : ''}`))
      lines.push('Run again with --yes. A run that stops part way resumes where it left off.')
      await deps.io.out(`${lines.join('\n')}\n`)
    }
    return 0
  }

  // Everything that could stop the final save is checked before the first transaction.
  const vault = await seams.vaultStatus(identity).catch(() => ({ ready: false }))
  if (!vault.ready) throw new HistoryError(1, 'Local continuity files are not restored.', 'Run `ethagent restore` first. Nothing was sent.')
  const jwt = await requireStorage(seams.resolveJwt)
  await seams.pullHarness(identity).catch(() => [])

  const tab = embed?.tab ?? new WalletTab(seams.openSession, deps.io, flags.json, flags.noOpen, seams.openExternal)
  const confirmed: string[] = []
  let saved: EthagentIdentity | undefined
  const callbacks = quietCallbacks()
  try {
    if (needDeploy) {
      const deployed = await seams.deploy({
        registry, walletAddress: owner, agentId, callbacks, session: await tab.get(), flowId: 'custody-switch', flowStep: 1,
        onDeployed: address => seams.recordVault(registry.chainId, address),
      })
      vaultAddress = deployed.vaultAddress
      confirmed.push(`Vault ${deployed.vaultAddress} deployed (${deployed.txHash})`)
    }
    if (needDeposit && vaultAddress) {
      const deposited = await seams.deposit({ identity, registry, vaultAddress, callbacks, session: await tab.get(), flowId: 'custody-switch', flowStep: 2 })
      const status = await seams.confirmDeposit({
        client, vaultAddress, registry: registry.identityRegistryAddress, agentId,
        pacing: receiptPacing(registry, client, deposited.receiptBlock),
      })
      if (status.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        throw new Error(`The Vault recorded the depositor as ${status.ownerAddress}, not ${owner}.`)
      }
      confirmed.push(`token deposited (${deposited.txHash})`)
    }
    if (revokeCandidates.length > 0 && vaultAddress) {
      const revoked = await seams.revoke({ identity, registry, vaultAddress, ownerAddress: owner, candidates: revokeCandidates, callbacks, session: await tab.get() })
      if (revoked.length > 0) confirmed.push(`revoked ${revoked.join(', ')}`)
    }
    if (needUnwrap && vaultAddress) {
      const unwrapped = await seams.unwrap({ identity, registry, vaultAddress, callbacks, session: await tab.get(), agentId })
      if (unwrapped) confirmed.push(`token withdrawn (${unwrapped.txHash})`)
    }
    if (addProof) {
      let proof: { account: Address; message: string; signature: string }
      if (operatorKey) {
        const message = addProof.challenge(operatorKey.address)
        proof = { account: operatorKey.address, message, signature: signMessage(operatorKey.key, message) }
      } else {
        const target = write.kind === 'add-operator' ? write.address : undefined
        proof = await (await tab.get()).requestSignature({
          chainId: registry.chainId,
          purpose: 'operator-proof',
          ...(target ? { expectedAccount: target } : {}),
          messageForAccount: account => addProof!.challenge(account),
        })
      }
      profileUpdates = addOperatorUpdates(addProof.ctx, operatorRecordFromProof(addProof.ctx, proof))
    }
    if (write.kind === 'advanced' && vaultAddress) profileUpdates = { ...profileUpdates, operatorVaultAddress: vaultAddress }
    const step: Extract<Step, { kind: 'rebackup-signing' }> = {
      kind: 'rebackup-signing',
      identity,
      registry,
      pinataJwt: jwt,
      profileUpdates: profileUpdates!,
      returnTo: { kind: 'menu' },
      ...(write.kind !== 'simple' && vaultAddress ? { vaultAddress } : {}),
    }
    await seams.publish(step, quietCallbacks({
      onIdentityComplete: async next => {
        await seams.saveConfig({ ...config, identity: next })
        saved = next
      },
    }), await tab.get(), write.kind === 'advanced' ? { flowId: 'custody-switch', flowStep: 3 } : undefined)
  } catch (err: unknown) {
    const cancelled = walletCancelled(err, confirmed)
    if (cancelled) throw cancelled
    if (confirmed.length > 0) {
      throw new HistoryError(4, `${err instanceof Error ? err.message : String(err)} Already confirmed: ${confirmed.join('; ')}. Run the same command again to finish.`)
    }
    throw err
  } finally {
    if (!embed) await tab.close()
  }
  if (!saved) throw new HistoryError(4, `The custody save did not complete.${confirmed.length ? ` Already confirmed: ${confirmed.join('; ')}.` : ''} Run the same command again to finish.`)
  const result = { applied: true, ...summary, vault: write.kind === 'simple' ? null : vaultAddress ?? null, confirmed, txHash: saved.backup?.txHash ?? null }
  if (embed) {
    embed.onResult(result)
    return 0
  }
  if (flags.json) await emitJson(deps.io, result)
  else await deps.io.out(`Done: ${[...confirmed, 'custody saved'].join('; ')}.\n`)
  return 0
}

async function done(deps: HistoryDeps, json: boolean, message: string): Promise<number> {
  if (json) await emitJson(deps.io, { applied: false, reason: 'nothing-to-do', message })
  else await deps.io.out(`${message} Nothing to do.\n`)
  return 0
}

