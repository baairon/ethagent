import { useEffect, useState } from 'react'
import type { EthagentIdentity } from '../../storage/config.js'
import { catFromIpfs, DEFAULT_IPFS_API_URL } from '../storage/ipfs.js'
import {
  continuityVaultRef,
  continuityVaultStatus,
  continuityWorkingTreeStatus,
  ensurePublicSkillsFile,
  type ContinuityWorkingTreeStatus,
} from '../continuity/storage.js'
import { openFileInEditor } from '../continuity/editor.js'
import { exportLocalBackup } from '../continuity/localBackup.js'
import { listPublishedContinuitySnapshots } from '../continuity/snapshots.js'
import type { Step } from './identityHubReducer.js'

type UseIdentityHubContinuityArgs = {
  identity: EthagentIdentity | undefined
  step: Step
  setStep: (step: Step) => void
  handleStepError: (err: unknown, backStep: Step, softCancel?: Step) => void
}

export function useIdentityHubContinuity({
  identity,
  step,
  setStep,
  handleStepError,
}: UseIdentityHubContinuityArgs): {
  continuityReady: boolean
  setContinuityReady: (ready: boolean) => void
  workingStatus: ContinuityWorkingTreeStatus | null
  openContinuityFile: (kind: 'soul' | 'memory' | 'skills') => Promise<void>
  exportLocalBackupZip: () => Promise<void>
} {
  const [continuityReady, setContinuityReady] = useState<boolean>(false)
  const [workingStatus, setWorkingStatus] = useState<ContinuityWorkingTreeStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!identity) {
      setContinuityReady(false)
      return
    }
    if (!step.kind.startsWith('continuity') && step.kind !== 'details' && step.kind !== 'menu') return
    continuityVaultStatus(identity)
      .then(status => { if (!cancelled) setContinuityReady(status.ready) })
      .catch(() => { if (!cancelled) setContinuityReady(false) })
    return () => { cancelled = true }
  }, [identity, step.kind])

  useEffect(() => {
    let cancelled = false
    if (!identity) return
    if (
      step.kind !== 'menu'
      && step.kind !== 'continuity-private'
      && step.kind !== 'continuity-public'
      && step.kind !== 'save-prompt'
      && step.kind !== 'rebackup-confirm'
    ) return

    const checkStatus = async () => {
      try {
        const [latest] = await listPublishedContinuitySnapshots(identity, 1)
        const status = await continuityWorkingTreeStatus(identity, latest)
        if (cancelled) return
        setWorkingStatus(status)
      } catch {
        if (cancelled) return
        setWorkingStatus(null)
      }
    }

    void checkStatus()

    return () => {
      cancelled = true
    }
  }, [identity, step.kind])

  const openContinuityFile = async (kind: 'soul' | 'memory' | 'skills'): Promise<void> => {
    if (!identity) return
    try {
      if (kind === 'skills') {
        await ensurePublicSkillsFile(identity, {
          fallback: () => readPublishedPublicSkills(identity),
        })
      }
      const ref = continuityVaultRef(identity)
      const file = kind === 'soul' ? ref.soulPath : kind === 'memory' ? ref.memoryPath : ref.publicSkillsPath
      const result = await openFileInEditor(file)
      const displayName = kind === 'soul' ? 'SOUL.md' : kind === 'memory' ? 'MEMORY.md' : 'skills.json'
      const message = result.ok
        ? `opened ${displayName} with ${result.method}.`
        : `open failed: ${result.error}`
      setStep({ kind: 'continuity-private', notice: message, editorOpened: result.ok })
    } catch (err: unknown) {
      handleStepError(err, { kind: 'continuity-private' })
    }
  }

  const exportLocalBackupZip = async (): Promise<void> => {
    if (!identity) return
    try {
      await ensurePublicSkillsFile(identity, {
        fallback: () => readPublishedPublicSkills(identity),
      })
      const result = await exportLocalBackup(identity)
      const message = result.ok
        ? `Saved local backup to ${result.path}`
        : result.cancelled
          ? 'Backup cancelled'
          : `Backup failed: ${result.error}`
      setStep({ kind: 'continuity-private', notice: message })
    } catch (err: unknown) {
      handleStepError(err, { kind: 'continuity-private' })
    }
  }

  return {
    continuityReady,
    setContinuityReady,
    workingStatus,
    openContinuityFile,
    exportLocalBackupZip,
  }
}

async function readPublishedPublicSkills(identity: EthagentIdentity): Promise<string> {
  const cid = identity.publicSkills?.cid
  if (!cid) throw new Error('No saved public skills CID')
  return new TextDecoder().decode(await catFromIpfs(
    identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
    cid,
  ))
}
