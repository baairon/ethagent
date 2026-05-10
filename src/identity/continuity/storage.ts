export type {
  ContinuityPublishState,
  ContinuitySnapshotContentHashes,
  ContinuitySnapshotFile,
  ContinuityVaultRef,
  ContinuityWorkingTreeStatus,
  IdentityMarkdownScaffold,
  PrivateContinuityFile,
} from './storage/types.js'
export { continuityVaultRef } from './storage/paths.js'
export {
  ensureContinuityFiles,
  ensureContinuityVault,
  readContinuityFiles,
  writeContinuityFiles,
} from './storage/files.js'
export { continuityAgentSnapshot, defaultContinuityFiles } from './storage/defaults.js'
export {
  ensureIdentityMarkdownScaffold,
  ensurePublicSkillsFile,
  prepareSyncedIdentityMarkdownScaffold,
  prepareSyncedPublicSkillsJson,
  readPublicSkillsFile,
  syncIdentityMarkdownScaffold,
  writeIdentityMarkdownScaffold,
  writePublicSkillsFile,
} from './storage/scaffold.js'
export {
  continuityVaultStatus,
  continuityWorkingTreeStatus,
  localContinuitySnapshotContentHashes,
} from './storage/status.js'
