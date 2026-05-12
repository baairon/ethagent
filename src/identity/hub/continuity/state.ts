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
  const files: Array<keyof typeof workingStatus.localContentHashes> = ['SOUL.md', 'MEMORY.md', 'skills.json']
  return files
    .filter(file => workingStatus.localContentHashes?.[file] !== workingStatus.publishedContentHashes?.[file])
    .map(displayContinuitySnapshotFile)
}

function displayContinuitySnapshotFile(file: keyof NonNullable<ContinuityWorkingTreeStatus['localContentHashes']>): string {
  return file
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
