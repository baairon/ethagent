import type { EthagentIdentity } from '../../../storage/config.js'
import type { PrivateContinuityFile } from '../storage.js'

export type PrivateContinuityEditInput = {
  file: PrivateContinuityFile
  oldText?: string
  newText?: string
  appendToSection?: string
  appendText?: string
  replaceAll?: boolean
  replaceWholeFile?: boolean
}

export type PreparedPrivateContinuityEdit = {
  identity: EthagentIdentity
  file: PrivateContinuityFile
  fullPath: string
  relativePath: string
  directoryPath: string
  existedBefore: boolean
  previousContent: string
  before: string
  after: string
  previewBefore: string
  previewAfter: string
  changeSummary: string
  diff: string
}
