import { checkpointVault } from '../../identity/continuity/snapshotCapture.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from './shared.js'

export const CHECKPOINT_USAGE = 'ethagent checkpoint [label] [--json]'

export async function runCheckpointCommand(args: string[], deps: HistoryDeps): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {}, CHECKPOINT_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${CHECKPOINT_USAGE}\nrecords the exact bytes of SOUL.md, MEMORY.md, and every skill file as a local checkpoint you can diff against or roll back to (cp:ID). nothing leaves the machine.\n`)
      return 0
    }
    const { identity } = await requireIdentity(deps)
    const label = positionals.join(' ').trim()
    const checkpoint = await checkpointVault(identity, 'manual', label ? { label } : {})
    if (!checkpoint) throw new HistoryError(1, 'the vault has no files to checkpoint yet')
    if (json) {
      await emitJson(deps.io, {
        ref: `cp:${checkpoint.id}`,
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        files: Object.keys(checkpoint.files).length,
        ...(checkpoint.label ? { label: checkpoint.label } : {}),
      })
    } else {
      await deps.io.out(`checkpoint cp:${checkpoint.id} (${Object.keys(checkpoint.files).length} files)\n`)
    }
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
