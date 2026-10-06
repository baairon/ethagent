import { getAddress } from 'viem'
import { fetchSnapshotIntoStore, type FetchOutcome } from '../../identity/continuity/snapshotFetch.js'
import { isForgottenCid } from '../../identity/continuity/snapshotStore.js'
import type { ChallengeSigner } from '../../identity/continuity/localKeyDecrypt.js'
import type { PublishedContinuitySnapshot } from '../../identity/continuity/snapshots.js'
import { DEFAULT_IPFS_API_URL } from '../../identity/storage/ipfs.js'
import { requestBrowserWalletSignature } from '../../identity/wallet/browserWallet.js'
import { openExternalUrl } from '../../utils/openExternal.js'
import type { EthagentIdentity } from '../../storage/config.js'
import { loadHistoryContext, resolveRef } from './refs.js'
import {
  emitJson,
  failFrom,
  HistoryError,
  parseHistoryArgs,
  requireIdentity,
  shortCid,
  type HistoryDeps,
  type HistoryIo,
} from './shared.js'

export const FETCH_USAGE = 'ethagent fetch [<ref> | --all] [--wallet] [--no-open] [--retry-locked] [--json]'

export type WalletSignerFactory = (identity: EthagentIdentity, io: HistoryIo, open: boolean) => ChallengeSigner

export const browserWalletSigner: WalletSignerFactory = (identity, io, open) => {
  const owner = getAddress(identity.ownerAddress ?? identity.address)
  const pending = new Map<string, Promise<string>>()
  return {
    address: owner,
    sign: challenge => {
      let signature = pending.get(challenge)
      if (!signature) {
        signature = requestBrowserWalletSignature({
          chainId: identity.chainId ?? 8453,
          expectedAccount: owner,
          message: challenge,
          purpose: 'refetch-snapshot',
          onReady: ready => {
            if (!ready) return
            void io.err(`Sign one no-spend message in your browser wallet to open older snapshots: ${ready.url}\n`)
            if (open) openExternalUrl(ready.url)
          },
        }).then(result => result.signature)
        pending.set(challenge, signature)
      }
      return signature
    },
  }
}

export async function runFetchCommand(args: string[], deps: HistoryDeps, walletSigner: WalletSignerFactory = browserWalletSigner): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      all: { type: 'boolean' },
      wallet: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      'retry-locked': { type: 'boolean' },
    }, FETCH_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${FETCH_USAGE}\ndownloads encrypted snapshots from IPFS, decrypts them on this machine, and caches their exact contents locally. uses the operator key in ETHAGENT_OPERATOR_KEY, or --wallet to sign with the owner wallet in the browser (one no-spend signature per access epoch).\n`)
      return 0
    }
    if (values.all && positionals.length > 0) throw new HistoryError(2, '--all takes no ref', `usage: ${FETCH_USAGE}`)
    if (positionals.length > 1) throw new HistoryError(2, 'fetch takes at most one ref', `usage: ${FETCH_USAGE}`)
    const { identity } = await requireIdentity(deps)
    const ctx = await loadHistoryContext(identity, deps)
    let targets: PublishedContinuitySnapshot[]
    let explicit = false
    if (values.all) targets = ctx.ledger.slice()
    else {
      const ref = resolveRef(positionals[0] ?? 'latest', ctx)
      if (ref.kind !== 'snapshot') throw new HistoryError(2, 'fetch works on published snapshots, not checkpoints or working')
      targets = [ref.entry]
      explicit = true
    }
    const signer = values.wallet ? walletSigner(identity, deps.io, !values['no-open']) : ctx.signer()
    if (!signer) {
      throw new HistoryError(3, 'no key to decrypt snapshots with', 'inject ETHAGENT_OPERATOR_KEY (for example via the keychain operator-fetch), or pass --wallet to sign with the owner wallet in the browser')
    }
    const apiUrl = identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL
    const outcomes: FetchOutcome[] = new Array(targets.length)
    let cursor = 0
    const concurrency = values.wallet ? 1 : 2
    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const index = cursor++
        const entry = targets[index]!
        if (!explicit && await isForgottenCid(identity, entry.cid)) {
          outcomes[index] = { cid: entry.cid, status: 'skipped', error: 'forgotten locally; name it explicitly to fetch again' }
          continue
        }
        outcomes[index] = await fetchSnapshotIntoStore(identity, entry, {
          apiUrl,
          signer,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        }, { retryLocked: Boolean(values['retry-locked']) || Boolean(values.wallet) })
        if (!json) {
          const outcome = outcomes[index]!
          await deps.io.err(`${shortCid(entry.cid)}  ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}${outcome.error ? ` (${outcome.error})` : ''}\n`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()))
    const count = (status: FetchOutcome['status']): number => outcomes.filter(outcome => outcome.status === status).length
    const totals = {
      cached: count('cached'),
      alreadyCached: count('already-cached'),
      locked: count('locked'),
      skipped: count('skipped'),
      errors: count('error'),
      needsKey: count('needs-key'),
    }
    const complete = totals.locked + totals.errors + totals.needsKey === 0
    if (json) await emitJson(deps.io, { keyAddress: signer.address, totals, outcomes })
    else {
      await deps.io.out(`fetched ${totals.cached}, already cached ${totals.alreadyCached}, locked ${totals.locked}, skipped ${totals.skipped}, errors ${totals.errors}\n`)
      if (totals.locked > 0 && !values.wallet) await deps.io.out('locked snapshots need a wallet with a slot in them; try `ethagent fetch --all --wallet` to sign with the owner wallet\n')
    }
    return complete ? 0 : 4
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
