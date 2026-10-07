import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import { resolveUploadCredential, resolveValidatedPinataJwt } from '../../identity/storage/pinataJwt.js'
import { runCreateSigning } from '../../identity/manager/create/effects.js'
import { scanImportCandidates, type ImportCandidate } from '../../identity/manager/create/importScan.js'
import { openBrowserWalletSession, type BrowserWalletReady, type BrowserWalletSession } from '../../identity/wallet/browserWallet.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, type HistoryDeps } from '../history/shared.js'
import { isWalletCancelled } from '../../identity/manager/shared/utils.js'
import { defaultCustodyWriteSeams, runCustodyWrite, type CustodyWriteSeams } from './custodyWrite.js'
import { parseNetwork, persistIdentity, quietCallbacks, registryForNetwork, requireStorage, walletCancelled, WalletTab } from './shared.js'

export const CREATE_USAGE = 'ethagent create --name <text> --network mainnet|base [--description <text>] [--advanced] [--import] [--replace] [--yes] [--no-open] [--json]'

const HELP = [
  `usage: ${CREATE_USAGE}`,
  '',
  'Mints a new ERC-8004 agent token to the wallet you approve with, with an encrypted first',
  'snapshot of its soul, memory, and skills. Previews until --yes. Needs gas on the network.',
  '',
  '  --advanced    continue into Advanced custody in the same browser tab: deploy a Vault,',
  '                deposit the token, and save',
  '  --import      fold the notes this machine\'s tools already hold into the first MEMORY.md',
  '  --replace     allowed when this machine already has an agent; its vault stays on disk',
  '',
  'Add an image afterwards with `ethagent profile --image <path|url>`.',
  '',
].join('\n')

export type CreateSeams = {
  sign: typeof runCreateSigning
  scanImports: () => Promise<ImportCandidate[]>
  resolveJwt: typeof resolveValidatedPinataJwt
  openSession: (onReady: (ready: BrowserWalletReady) => void) => Promise<BrowserWalletSession>
  openExternal: (url: string) => void
  saveConfig: (config: EthagentConfig) => Promise<void>
  custody: CustodyWriteSeams
}

export const defaultSeams: CreateSeams = {
  sign: runCreateSigning,
  scanImports: scanImportCandidates,
  resolveJwt: resolveUploadCredential,
  openSession: onReady => openBrowserWalletSession({ title: 'ethagent create', onReady }),
  openExternal: url => openExternalUrl(url),
  saveConfig,
  custody: defaultCustodyWriteSeams,
}

export async function runCreateCommand(args: string[], deps: HistoryDeps, seams: CreateSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      name: { type: 'string' },
      description: { type: 'string' },
      network: { type: 'string' },
      advanced: { type: 'boolean' },
      import: { type: 'boolean' },
      replace: { type: 'boolean' },
      yes: { type: 'boolean' },
      'no-open': { type: 'boolean' },
    }, CREATE_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length > 0) throw new HistoryError(2, `unexpected argument: ${positionals[0]}`, `usage: ${CREATE_USAGE}`)
    const name = typeof values.name === 'string' ? values.name.trim() : ''
    if (name.length < 2) throw new HistoryError(2, '--name needs at least 2 characters', `usage: ${CREATE_USAGE}`)
    const network = parseNetwork(values.network)
    if (!network) throw new HistoryError(2, 'Which network should the agent live on?', 'Pass --network mainnet or --network base; minting costs gas there.')
    const description = typeof values.description === 'string' ? values.description.trim() : ''
    const custodyMode = values.advanced ? 'advanced' as const : 'simple' as const

    const config = await deps.loadConfig().catch(() => null)
    const existing = config?.identity
    if (existing?.agentId && !values.replace) {
      throw new HistoryError(1, `This machine already has agent #${existing.agentId}.`, 'Pass --replace to create another; the current vault stays on disk and `ethagent restore` brings it back.')
    }
    const registry = registryForNetwork(network)
    const imports = values.import ? await seams.scanImports() : []
    const summary = {
      action: 'create',
      name,
      description: description || null,
      network,
      chainId: registry.chainId,
      custody: custodyMode,
      imports: imports.map(item => ({ source: item.source, lines: item.contentLines })),
      replaces: existing?.agentId ?? null,
      steps: [
        { step: 'mint', description: `mint the agent token on ${network} and pin its first snapshot`, signer: 'the wallet you approve with (it becomes the owner)' },
        ...(custodyMode === 'advanced'
          ? [
              { step: 'deploy', description: 'deploy a Vault bound to the new token', signer: 'owner wallet' },
              { step: 'deposit', description: 'deposit the token into the Vault', signer: 'owner wallet' },
              { step: 'save', description: 'publish Advanced custody, through the Vault', signer: 'owner wallet' },
            ]
          : []),
      ],
    }
    if (!values.yes) {
      if (json) {
        await emitJson(deps.io, { applied: false, ...summary })
      } else {
        const lines = [`Preview (nothing pinned or sent). Create "${name}" on ${network}${custodyMode === 'advanced' ? ' in Advanced custody' : ''}.`]
        summary.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step.description} [${step.signer}]`))
        if (values.import) lines.push(imports.length ? `  imports notes from ${imports.map(item => item.source).join(', ')}` : '  no notes worth importing were found')
        if (existing?.agentId) lines.push(`  note: replaces agent #${existing.agentId} on this machine; its vault stays on disk`)
        lines.push('Run again with --yes to create. Every step runs in one browser tab.')
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }

    const jwt = await requireStorage(seams.resolveJwt)
    const tab = new WalletTab(seams.openSession, deps.io, json, Boolean(values['no-open']), seams.openExternal)
    let created: EthagentIdentity | undefined
    let createdConfig: EthagentConfig | undefined
    let custodyResult: Record<string, unknown> | undefined
    try {
      await seams.sign({
        kind: 'create-signing',
        name,
        description,
        registry,
        custodyMode,
        pinataJwt: jwt,
        ...(imports.length ? { importNotes: imports } : {}),
      }, quietCallbacks({
        onIdentityComplete: async next => {
          createdConfig = await persistIdentity(next, { loadConfig: deps.loadConfig, saveConfig: seams.saveConfig })
          created = next
        },
      }), { session: await tab.get() })
      if (!created || !createdConfig) throw new HistoryError(1, 'The mint did not complete; nothing was saved.')
      if (custodyMode === 'advanced') {
        await runCustodyWrite({ kind: 'advanced' }, { yes: true, json, noOpen: Boolean(values['no-open']), operator: false }, deps, createdConfig, created, seams.custody, {
          tab,
          onResult: result => { custodyResult = result },
        })
      }
    } catch (err: unknown) {
      if (created) {
        // The mint landed and is saved; only the custody switch is left.
        const reason = isWalletCancelled(err) ? 'Wallet approval was cancelled.' : err instanceof Error ? err.message : String(err)
        throw new HistoryError(4, `${reason} Agent #${created.agentId} was minted and saved on this machine; finish Advanced custody with \`ethagent custody --advanced\`.`)
      }
      const cancelled = walletCancelled(err, [])
      if (cancelled) throw cancelled
      throw err
    } finally {
      await tab.close()
    }
    const result = {
      applied: true,
      ...summary,
      agentId: created.agentId ?? null,
      owner: created.ownerAddress ?? null,
      txHash: created.backup?.txHash ?? null,
      ...(custodyResult ? { custodyResult } : {}),
    }
    if (json) await emitJson(deps.io, result)
    else await deps.io.out(`Created agent #${created.agentId} on ${network}${custodyResult ? ' in Advanced custody' : ''}.\n`)
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
