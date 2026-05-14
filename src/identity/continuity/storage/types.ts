import type { ContinuityFiles } from '../envelope.js'

export const PRIVATE_CONTINUITY_FILES = ['SOUL.md', 'MEMORY.md'] as const
export type PrivateContinuityFile = (typeof PRIVATE_CONTINUITY_FILES)[number]

export type ContinuityVaultRef = {
  dir: string
  soulPath: string
  memoryPath: string
  publicSkillsPath: string
  skillsDir: string
}

export type IdentityMarkdownScaffold = ContinuityFiles & {
  'skills.json': string
}

export type ContinuitySnapshotFile = PrivateContinuityFile | 'skills.json' | 'private-skills'
export type ContinuitySnapshotContentHashes = Partial<Record<ContinuitySnapshotFile, string>> & Record<PrivateContinuityFile | 'skills.json', string>
export type ContinuityPublishState = 'not-restored' | 'not-published' | 'verify-needed' | 'local-changes' | 'published'
export type ContinuityWorkingTreeStatus = {
  ready: boolean
  newestLocalChangeAt?: string
  localChangedAfterBackup: boolean
  publishState: ContinuityPublishState
  localContentHashes?: ContinuitySnapshotContentHashes
  publishedContentHashes?: ContinuitySnapshotContentHashes
}
