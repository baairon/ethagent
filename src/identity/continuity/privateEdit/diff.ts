import type { PrivateContinuityFile } from '../storage.js'
import { renderUnifiedFileDiff } from '../../../tools/fileDiff.js'

export function renderPrivateContinuityDiff(file: PrivateContinuityFile, before: string, after: string): string {
  return renderUnifiedFileDiff({ filePath: file, before, after })
}
