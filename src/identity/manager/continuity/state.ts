import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import type { ChangeKind, LocalChanges } from '../../continuity/localChanges.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import { plural } from '../../../ui/text.js'

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
  items: LocalChangeItem[]
  hasLocalChanges: boolean
}

export type LocalChangeItem = {
  name: string
  kind: 'file' | 'skill' | 'card' | 'skills'
  change: ChangeKind
}

export function localChangeItems(workingStatus?: ContinuityWorkingTreeStatus | null): LocalChangeItem[] {
  if (!workingStatus || workingStatus.publishState !== 'local-changes') return []
  if (workingStatus.changes) {
    const exact = exactChangeItems(workingStatus.changes)
    if (exact.length > 0) return exact
  }
  return changedContinuitySnapshotFiles(workingStatus).map(name => name === 'Skills'
    ? { name, kind: 'skills' as const, change: 'modified' as const }
    : { name, kind: 'file' as const, change: 'modified' as const })
}

function exactChangeItems(changes: LocalChanges): LocalChangeItem[] {
  const items: LocalChangeItem[] = []
  for (const name of ['SOUL.md', 'MEMORY.md']) {
    const file = changes.files.find(entry => entry.path === name)
    if (file) items.push({ name, kind: 'file', change: file.change })
  }
  for (const skill of changes.skills) items.push({ name: skill.name, kind: 'skill', change: skill.change })
  if (items.length === 0 && changes.files.some(entry => entry.path === 'agent-card.json')) {
    items.push({ name: 'Agent Card', kind: 'card', change: 'modified' })
  }
  return items
}

export function changeSummaryCandidates(items: LocalChangeItem[]): string[] {
  if (items.length === 0) return []
  const candidates = [items.map(item => item.name).join(', ')]
  const skills = items.filter(item => item.kind === 'skill')
  if (skills.length > 1) {
    const others = items.filter(item => item.kind !== 'skill').map(item => item.name)
    candidates.push([...others, plural(skills.length, 'skill')].join(', '))
  }
  if (items.length > 1) candidates.push(plural(items.length, 'change'))
  return candidates
}

export function changeLabel(item: LocalChangeItem): string {
  if (item.kind === 'skill') {
    if (item.change === 'added') return 'New skill'
    if (item.change === 'removed') return 'Skill removed'
    return 'Skill edited'
  }
  if (item.change === 'added') return 'Added'
  if (item.change === 'removed') return 'Removed'
  return 'Edited'
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
      items: [],
      hasLocalChanges: false,
    }
  }

  if (workingStatus.publishState === 'published') {
    return {
      label: 'Local Changes',
      detail: 'None detected',
      tone: 'ok',
      files: [],
      items: [],
      hasLocalChanges: false,
    }
  }

  if (workingStatus.publishState === 'local-changes') {
    const items = localChangeItems(workingStatus)
    const files = items.map(item => item.name)
    return {
      label: 'Local Changes',
      detail: files.length > 0 ? `Detected: ${files.join(', ')}` : 'Detected: local files differ from saved snapshot',
      tone: 'warn',
      files,
      items,
      hasLocalChanges: true,
    }
  }

  if (workingStatus.publishState === 'not-published') {
    return {
      label: 'Local Changes',
      detail: 'Snapshot not saved yet',
      tone: 'warn',
      files: [],
      items: [],
      hasLocalChanges: false,
    }
  }

  if (workingStatus.publishState === 'verify-needed') {
    return {
      label: 'Local Changes',
      detail: 'Unable to verify saved snapshot',
      tone: 'warn',
      files: [],
      items: [],
      hasLocalChanges: false,
    }
  }

  return {
    label: 'Local Changes',
    detail: 'Local files not restored',
    tone: 'warn',
    files: [],
    items: [],
    hasLocalChanges: false,
  }
}
