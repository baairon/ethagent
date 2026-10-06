import { getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import {
  VAULT_ABI,
  isAgentInVault,
  readMetadataOperators,
  vaultBuildForHash,
  vaultRevertName,
  type VaultBuild,
} from '../../identity/registry/vault.js'
import { createErc8004PublicClient, type Erc8004RegistryConfig } from '../../identity/registry/erc8004.js'
import { ERC8004_ABI } from '../../identity/registry/erc8004/abi.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import { resolveVaultAddress } from '../../identity/manager/custody/transactions.js'
import { readCustodyMode, readIdentityStateString } from '../../identity/manager/custody/state.js'
import { humanOwnerAddress } from '../../identity/manager/custody/helpers.js'
import { normalizeApprovedOperatorWallets } from '../../identity/manager/shared/operatorWallets.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from '../history/shared.js'
import { defaultCustodyWriteSeams, parseCustodyWrite, runCustodyWrite, type CustodyWriteSeams } from './custodyWrite.js'

export const CUSTODY_USAGE = 'ethagent custody [--verify | --advanced | --simple | --add-operator [<address>] | --remove-operator <address> | --activate-operator <address>] [--operator] [--yes] [--no-open] [--json]'

const STRANGER = getAddress('0x000000000000000000000000000000000000dEaD')
const ZERO = '0x0000000000000000000000000000000000000000'

export type CustodyClient = Pick<PublicClient, 'readContract' | 'getBytecode' | 'simulateContract'>

export type CustodySeams = {
  client: (registry: Erc8004RegistryConfig) => CustodyClient
}

const defaultSeams: CustodySeams = {
  client: registry => createErc8004PublicClient(registry),
}

type Simulation = {
  check: string
  from: Address
  expected: 'succeed' | 'refused'
  outcome: 'would succeed' | 'refused'
  reason?: string
  matches: boolean
}

async function simulate(
  client: CustodyClient,
  check: string,
  from: Address,
  expected: Simulation['expected'],
  call: { address: Address; functionName: 'unwrap' | 'setMetadataOperator' | 'rotateAgentURI'; args: readonly unknown[] },
): Promise<Simulation> {
  try {
    await client.simulateContract({
      account: from,
      address: call.address,
      abi: VAULT_ABI,
      functionName: call.functionName,
      args: call.args as never,
    } as never)
    return { check, from, expected, outcome: 'would succeed', matches: expected === 'succeed' }
  } catch (err: unknown) {
    const named = vaultRevertName(err)
    const reason = named ?? ((err as { shortMessage?: string }).shortMessage ?? (err instanceof Error ? err.message : String(err))).split('\n')[0]!
    return { check, from, expected, outcome: 'refused', reason, matches: expected === 'refused' }
  }
}

export async function runCustodyCommand(
  args: string[],
  deps: HistoryDeps,
  seams: CustodySeams = defaultSeams,
  writeSeams: CustodyWriteSeams = defaultCustodyWriteSeams,
): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      verify: { type: 'boolean' },
      advanced: { type: 'boolean' },
      simple: { type: 'boolean' },
      'add-operator': { type: 'boolean' },
      'remove-operator': { type: 'string' },
      'activate-operator': { type: 'string' },
      operator: { type: 'boolean' },
      yes: { type: 'boolean' },
      'no-open': { type: 'boolean' },
    }, CUSTODY_USAGE)
    if (values.help) {
      await deps.io.out([
        `usage: ${CUSTODY_USAGE}`,
        'shows the custody mode, the Vault and its build, whether it holds the agent token, the',
        'Vault-level owner, and the approved operators. Read-only.',
        '--verify also simulates, with eth_call and without sending anything: the owner withdrawing,',
        'the owner changing an operator, the operator rotating the agent URI, and the operator and a',
        'stranger being refused. Exits 4 when any result differs from what the Vault should do.',
        '',
        'Changes (preview until --yes, every wallet prompt in one browser tab, owner wallet signs):',
        '  --advanced                       deploy a Vault (or reuse one), deposit the token, then save',
        '  --simple                         revoke the Vault operators, withdraw the token, then save',
        '  --add-operator [<address>]       approve an operator; it signs a proof in the browser, or',
        '                                   with --operator the injected operator key signs it locally',
        '  --remove-operator <address>      remove an operator and revoke it on the Vault',
        '  --activate-operator <address>    make an approved operator the active one',
        'Each change is planned from chain state, so a run that stops part way resumes when run again.',
        '',
      ].join('\n'))
      return 0
    }
    const { config, identity } = await requireIdentity(deps)
    const write = parseCustodyWrite(values, positionals)
    if (write) {
      return await runCustodyWrite(write, {
        yes: Boolean(values.yes),
        json,
        noOpen: Boolean(values['no-open']),
        operator: Boolean(values.operator),
      }, deps, config, identity, writeSeams)
    }
    if (values.yes || values.operator) throw new HistoryError(2, '--yes and --operator need a change: --advanced, --simple, or an operator flag', `usage: ${CUSTODY_USAGE}`)
    if (!identity.agentId) throw new HistoryError(1, 'This identity has no agent token ID yet.', 'Create or restore it with `npx ethagent` first.')
    const registry = resolveRegistryForIdentity(identity, config)
    if (!registry) throw new HistoryError(1, 'No agent registry is configured for this identity.', 'Run `npx ethagent` to set it up.')
    const agentId = BigInt(identity.agentId)
    const state = identity.state as Record<string, unknown> | undefined
    const custodyMode = readCustodyMode(state) ?? 'simple'
    const owner = getAddress(humanOwnerAddress(identity))
    const operators = normalizeApprovedOperatorWallets(state?.approvedOperatorWallets).map(record => getAddress(record.address))
    const activeOperatorRaw = readIdentityStateString(state, 'activeOperatorAddress')
    const activeOperator = /^0x[0-9a-fA-F]{40}$/.test(activeOperatorRaw) ? getAddress(activeOperatorRaw) : undefined
    const keyAddress = deps.operatorKey?.ok ? getAddress(deps.operatorKey.address) : undefined
    const vaultAddress = resolveVaultAddress(identity, config.erc8004?.operatorVaults)
    const client = seams.client(registry)

    const tokenOwner = getAddress(await client.readContract({
      address: registry.identityRegistryAddress,
      abi: ERC8004_ABI,
      functionName: 'ownerOf',
      args: [agentId],
    }) as Address)

    let vault: Record<string, unknown> | null = null
    let build: VaultBuild | undefined
    let inVault = false
    let vaultOwner: Address | undefined
    let approvals: Record<string, boolean> = {}
    let held: { registry: Address; agentId: string; owner: Address } | null = null
    const issues: string[] = []
    if (vaultAddress) {
      const code = await client.getBytecode({ address: vaultAddress })
      const hasCode = Boolean(code && code !== '0x')
      const observedHash: Hex | null = hasCode ? keccak256(code!) : null
      build = observedHash ? vaultBuildForHash(observedHash) : undefined
      if (!hasCode) issues.push(`no contract at the Vault address ${vaultAddress}`)
      else if (!build) issues.push(`the code at ${vaultAddress} is not a known Vault build (hash ${observedHash})`)
      if (build) {
        const status = await isAgentInVault({ client, vaultAddress, registry: registry.identityRegistryAddress, agentId })
        inVault = status.inVault
        vaultOwner = status.ownerAddress
        if (build.hasHeldAgent) {
          const [heldRegistry, heldId, heldOwner] = await client.readContract({
            address: vaultAddress,
            abi: VAULT_ABI,
            functionName: 'heldAgent',
          }) as readonly [Address, bigint, Address]
          held = heldOwner.toLowerCase() === ZERO ? null : { registry: getAddress(heldRegistry), agentId: heldId.toString(), owner: getAddress(heldOwner) }
        }
        const candidates = [...new Set([...operators, ...(activeOperator ? [activeOperator] : []), ...(keyAddress ? [keyAddress] : [])])]
        approvals = candidates.length > 0
          ? await readMetadataOperators({ client, vaultAddress, registry: registry.identityRegistryAddress, agentId, candidates })
          : {}
      }
      vault = {
        address: vaultAddress,
        code: hasCode ? { bytes: (code!.length - 2) / 2, hash: observedHash } : null,
        build: build ? { id: build.id, label: build.label, hasHeldAgent: build.hasHeldAgent } : null,
        bytecode: !hasCode ? 'no code' : build ? 'known build' : 'unknown code',
        holdsToken: inVault,
        vaultOwner: vaultOwner ?? null,
        heldAgent: build?.hasHeldAgent ? held : 'not available on this build',
        operators: Object.entries(approvals).map(([address, approved]) => ({
          address,
          approved,
          local: operators.some(item => item.toLowerCase() === address.toLowerCase()),
          active: activeOperator?.toLowerCase() === address.toLowerCase(),
          operatorKey: keyAddress?.toLowerCase() === address.toLowerCase(),
        })),
      }
    }

    let simulations: Simulation[] | undefined
    if (values.verify) {
      simulations = []
      if (!vaultAddress) {
        issues.push('no Vault is configured, so there is nothing to simulate')
      } else if (!build) {
        // Unknown code is already an issue above.
      } else if (!inVault || !vaultOwner) {
        issues.push(`the Vault does not hold token #${agentId.toString()}, so its permissions cannot be simulated`)
      } else {
        const registryAddress = registry.identityRegistryAddress
        const operator = keyAddress ?? activeOperator ?? operators[0]
        const currentUri = await client.readContract({
          address: registryAddress,
          abi: ERC8004_ABI,
          functionName: 'tokenURI',
          args: [agentId],
        }) as string
        simulations.push(await simulate(client, 'owner withdraws the token', vaultOwner, 'succeed', {
          address: vaultAddress, functionName: 'unwrap', args: [registryAddress, agentId, vaultOwner],
        }))
        simulations.push(await simulate(client, 'owner changes an operator', vaultOwner, 'succeed', {
          address: vaultAddress, functionName: 'setMetadataOperator', args: [registryAddress, agentId, operator ?? STRANGER, true],
        }))
        if (operator) {
          const approved = approvals[operator] ?? false
          simulations.push(await simulate(client, 'operator rotates the agent URI', operator, approved ? 'succeed' : 'refused', {
            address: vaultAddress, functionName: 'rotateAgentURI', args: [registryAddress, agentId, currentUri],
          }))
          simulations.push(await simulate(client, 'operator withdraws the token', operator, 'refused', {
            address: vaultAddress, functionName: 'unwrap', args: [registryAddress, agentId, operator],
          }))
        }
        simulations.push(await simulate(client, 'stranger rotates the agent URI', STRANGER, 'refused', {
          address: vaultAddress, functionName: 'rotateAgentURI', args: [registryAddress, agentId, currentUri],
        }))
        simulations.push(await simulate(client, 'stranger withdraws the token', STRANGER, 'refused', {
          address: vaultAddress, functionName: 'unwrap', args: [registryAddress, agentId, STRANGER],
        }))
        for (const item of simulations) {
          if (!item.matches) issues.push(`${item.check}: expected it to ${item.expected === 'succeed' ? 'succeed' : 'be refused'}, but it ${item.outcome === 'refused' ? `was refused (${item.reason})` : 'would succeed'}`)
        }
      }
    }

    const result = {
      agentId: identity.agentId,
      chainId: registry.chainId,
      custodyMode,
      owner,
      tokenOwner,
      tokenHeldBy: vaultAddress && tokenOwner.toLowerCase() === vaultAddress.toLowerCase() ? 'vault' : tokenOwner.toLowerCase() === owner.toLowerCase() ? 'owner' : 'other',
      vault,
      ...(simulations ? { simulations } : {}),
      issues,
    }
    const mismatch = Boolean(values.verify) && issues.length > 0
    if (json) {
      await emitJson(deps.io, result)
    } else {
      const out: string[] = []
      out.push(`agent #${identity.agentId} · ${custodyMode} custody · owner ${owner}`)
      out.push(`token held by: ${result.tokenHeldBy} (${tokenOwner})`)
      if (!vaultAddress) {
        out.push('vault: none configured')
      } else {
        out.push(`vault: ${vaultAddress}`)
        out.push(`  build: ${build ? `${build.label}${build.hasHeldAgent ? '' : ' (no heldAgent())'}` : 'not recognized'}`)
        out.push(`  bytecode: ${String(vault?.bytecode)}`)
        out.push(`  holds #${identity.agentId}: ${inVault ? 'yes' : 'no'}${vaultOwner ? ` · vault-level owner ${vaultOwner}` : ''}`)
        const rows = (vault?.operators as Array<{ address: string; approved: boolean; operatorKey: boolean; active: boolean }> | undefined) ?? []
        if (rows.length === 0) out.push('  operators: none listed')
        for (const row of rows) {
          out.push(`  operator ${row.address}: ${row.approved ? 'approved' : 'not approved'}${row.active ? ' · active' : ''}${row.operatorKey ? ' · operator key' : ''}`)
        }
      }
      for (const item of simulations ?? []) {
        out.push(`${item.matches ? 'ok  ' : 'FAIL'} ${item.check}: ${item.outcome}${item.reason ? ` (${item.reason})` : ''}`)
      }
      for (const issue of issues) out.push(`issue: ${issue}`)
      await deps.io.out(`${out.join('\n')}\n`)
    }
    return mismatch ? 4 : 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
