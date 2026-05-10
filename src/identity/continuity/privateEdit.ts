import path from 'node:path'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import type { EthagentConfig } from '../../storage/config.js'
import { ensureContinuityVault } from './storage.js'
import { ensureTrailingNewline } from './storage/files.js'
import { applyPrivateContinuityEdit } from './privateEdit/apply.js'
import { renderPrivateContinuityDiff } from './privateEdit/diff.js'
import { privateContinuityPath, readPrivateContinuityFile } from './privateEdit/files.js'
import type { PreparedPrivateContinuityEdit, PrivateContinuityEditInput } from './privateEdit/types.js'

export type { PreparedPrivateContinuityEdit, PrivateContinuityEditInput } from './privateEdit/types.js'

export async function preparePrivateContinuityEdit(
  input: PrivateContinuityEditInput,
  config: EthagentConfig | undefined,
): Promise<PreparedPrivateContinuityEdit> {
  const identity = config?.identity
  if (!identity) {
    throw new Error('No active identity; create or load an identity before proposing private continuity edits')
  }

  const fullPath = privateContinuityPath(identity, input.file)
  const existing = await readPrivateContinuityFile(identity, input.file, fullPath)
  const applied = applyPrivateContinuityEdit(input, existing.content, identity)

  return {
    identity,
    file: input.file,
    fullPath,
    relativePath: 'identity-vault/' + input.file,
    directoryPath: path.dirname(fullPath),
    existedBefore: existing.existedBefore,
    previousContent: existing.existedBefore ? existing.content : '',
    before: existing.content,
    after: applied.after,
    previewBefore: applied.previewBefore,
    previewAfter: applied.previewAfter,
    changeSummary: applied.summary,
    diff: renderPrivateContinuityDiff(input.file, applied.before, applied.after),
  }
}

export async function writePreparedPrivateContinuityEdit(edit: PreparedPrivateContinuityEdit): Promise<void> {
  await ensureContinuityVault(edit.identity)
  await atomicWriteText(edit.fullPath, ensureTrailingNewline(edit.after), { mode: 0o600 })
}
