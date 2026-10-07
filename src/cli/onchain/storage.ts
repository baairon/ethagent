import { clearPinataJwt, hasPinataJwt, savePinataJwt } from '../../identity/storage/pinataJwt.js'
import { DEFAULT_IPFS_API_URL, isPinataUploadUrl } from '../../identity/storage/ipfs.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, type HistoryDeps } from '../history/shared.js'

export const STORAGE_USAGE = 'ethagent storage [--set | --forget [--yes]] [--json]'

const HELP = [
  `usage: ${STORAGE_USAGE}`,
  '',
  '  ethagent storage                 where snapshots are pinned and whether a credential is set.',
  '                                   Read-only.',
  '  ethagent storage --set           read a Pinata JWT from stdin, check it with Pinata, and save',
  '                                   it encrypted. Never pass it as an argument.',
  '  ethagent storage --forget        remove the saved credential (preview, then --yes).',
  '',
  'PINATA_JWT in the environment works too. ETHAGENT_IPFS_API_URL replaces Pinata entirely.',
  '',
].join('\n')

export type StorageSeams = {
  has: () => Promise<boolean>
  save: (input: string) => Promise<{ backend: string }>
  clear: () => Promise<void>
  readStdin: () => Promise<string>
  apiUrl: string
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new HistoryError(2, 'Pipe the JWT on stdin.', 'For example from your keychain tooling; never type it into a command line.')
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

export const defaultSeams: StorageSeams = {
  has: hasPinataJwt,
  save: async input => {
    const saved = await savePinataJwt(input)
    return { backend: String(saved.backend) }
  },
  clear: clearPinataJwt,
  readStdin: readAllStdin,
  apiUrl: DEFAULT_IPFS_API_URL,
}

export async function runStorageCommand(args: string[], deps: HistoryDeps, seams: StorageSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      set: { type: 'boolean' },
      forget: { type: 'boolean' },
      yes: { type: 'boolean' },
    }, STORAGE_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length > 0) {
      throw new HistoryError(2, 'The JWT is read from stdin, never from an argument.', `usage: ${STORAGE_USAGE}`)
    }
    if (values.set && values.forget) throw new HistoryError(2, 'choose either --set or --forget', `usage: ${STORAGE_USAGE}`)
    const pinata = isPinataUploadUrl(seams.apiUrl)

    if (values.set) {
      if (!pinata) throw new HistoryError(1, `Snapshots go to ${seams.apiUrl} (ETHAGENT_IPFS_API_URL), which needs no Pinata credential.`)
      const input = (await seams.readStdin()).trim()
      if (!input) throw new HistoryError(2, 'No JWT arrived on stdin.')
      let saved: { backend: string }
      try {
        saved = await seams.save(input)
      } catch (err: unknown) {
        throw new HistoryError(1, err instanceof Error ? err.message : String(err), 'Nothing was saved.')
      }
      if (json) await emitJson(deps.io, { saved: true, backend: saved.backend })
      else await deps.io.out(`Pinata credential checked and saved (${saved.backend}).\n`)
      return 0
    }

    const saved = await seams.has()
    if (values.forget) {
      if (!saved) {
        if (json) await emitJson(deps.io, { applied: false, reason: 'nothing-saved' })
        else await deps.io.out('No credential is saved; nothing to forget.\n')
        return 0
      }
      if (!values.yes) {
        if (json) await emitJson(deps.io, { applied: false, action: 'forget' })
        else await deps.io.out('Preview: removes the saved Pinata credential. PINATA_JWT, if set, still works. Run again with --yes.\n')
        return 0
      }
      await seams.clear()
      if (json) await emitJson(deps.io, { applied: true, action: 'forget' })
      else await deps.io.out('Saved Pinata credential removed.\n')
      return 0
    }
    if (values.yes) throw new HistoryError(2, '--yes only applies to --forget', `usage: ${STORAGE_USAGE}`)

    const env = Boolean(deps.env.PINATA_JWT?.trim())
    const view = {
      uploadsTo: seams.apiUrl,
      provider: pinata ? 'pinata' : 'custom',
      savedCredential: saved,
      envCredential: env,
      ready: !pinata || saved || env,
    }
    if (json) {
      await emitJson(deps.io, view)
    } else {
      const lines = [`uploads to ${view.uploadsTo}`]
      if (pinata) {
        lines.push(`saved credential: ${saved ? 'yes' : 'no'} · PINATA_JWT: ${env ? 'set' : 'not set'}`)
        if (!view.ready) lines.push('Not ready: save one with `ethagent storage --set` (reads the JWT from stdin).')
      }
      await deps.io.out(`${lines.join('\n')}\n`)
    }
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
