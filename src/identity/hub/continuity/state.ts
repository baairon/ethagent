import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import type { EthagentIdentity } from '../../../storage/config.js'

export function hasPendingPublish(identity?: EthagentIdentity): boolean {
  if (!identity?.backup?.cid) return false
  if (!identity.metadataCid) return false
  if (!identity.backup.metadataCid) return true
  return identity.backup.metadataCid !== identity.metadataCid
}

export type LocalChangeStatusView = {
  label: string
  detail: string
  tone: 'ok' | 'warn' | 'dim'
  files: string[]
  hasLocalChanges: boolean
}

export function changedContinuitySnapshotFiles(
  workingStatus?: ContinuityWorkingTreeStatus | null,
): string[] {
  if (!workingStatus?.localContentHashes || !workingStatus.publishedContentHashes) return []
  const local = workingStatus.localContentHashes
  const published = workingStatus.publishedContentHashes
  const changed = (file: keyof typeof local): boolean =>
    (local[file] ?? '') !== (published[file] ?? '')
  const result: string[] = []
  if (changed('SOUL.md')) result.push('SOUL.md')
  if (changed('MEMORY.md')) result.push('MEMORY.md')
  if (changed('agent-card.json') || changed('private-skills')) result.push('Skills')
  return result
}

export function localChangeStatusView(
  workingStatus?: ContinuityWorkingTreeStatus | null,
): LocalChangeStatusView {
  if (!workingStatus) {
    return {
      label: 'Local Changes',
      detail: '',
      tone: 'dim',
      files: [],
      hasLocalChanges: false,
    }
  }

  if (workingStatus.publishState === 'published') {
    return {
      label: 'Local Changes',
      detail: 'None detected',
      tone: 'ok',
      files: [],
      hasLocalChanges: false,
    }
  }

  if (workingStatus.publishState === 'local-changes') {
    const files = changedContinuitySnapshotFiles(workingStatus)
    return {
      label: 'Local Changes',
      detail: files.length > 0 ? `Detected: ${files.join(', ')}` : 'Detected: local files differ from saved snapshot',
      tone: 'warn',
      files,
      hasLocalChanges: true,
    }
  }

  if (workingStatus.publishState === 'not-published') {
    return {
      label: 'Local Changes',
      detail: 'Snapshot not saved yet',
      tone: 'warn',
      files: [],
      hasLocalChanges: false,
    }
  }

  if (workingStatus.publishState === 'verify-needed') {
    return {
      label: 'Local Changes',
      detail: 'Unable to verify saved snapshot',
      tone: 'warn',
      files: [],
      hasLocalChanges: false,
    }
  }

  return {
    label: 'Local Changes',
    detail: 'Local files not restored',
    tone: 'warn',
    files: [],
    hasLocalChanges: false,
  }
}
