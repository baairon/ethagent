import { useEffect, useState } from 'react'
import type { EthagentIdentity } from '../../storage/config.js'
import { catFromIpfs, DEFAULT_IPFS_API_URL } from '../storage/ipfs.js'
import {
  continuityVaultStatus,
  continuityWorkingTreeStatus,
  ensureAgentCardFile,
  type ContinuityWorkingTreeStatus,
} from '../continuity/storage.js'
import { openFileInEditor, openInFileManager } from '../continuity/editor.js'
import { listPublishedContinuitySnapshots } from '../continuity/snapshots.js'
import {
  createSkillFile,
  deleteSkillEntry,
  invalidateSkillsCache,
  readSkillByRelativePath,
  setSkillVisibility as setSkillVisibilityStorage,
} from '../continuity/skills/loadSkills.js'
import type { SkillVisibility } from '../continuity/skills/types.js'
import { syncAgentCardManifest } from '../continuity/skills/publicSkillsSync.js'
import { continuityVaultRef } from '../continuity/storage.js'
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
  openSkillFile: (relativePath: string) => Promise<void>
  openSkillsFolder: () => Promise<void>
  createSkill: (name: string, visibility: SkillVisibility) => Promise<void>
  deleteSkill: (relativePath: string) => Promise<void>
  setSkillVisibility: (relativePath: string, visibility: SkillVisibility) => Promise<void>
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
      && step.kind !== 'continuity-skills-tree'
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

  const requireReadyVault = async (): Promise<EthagentIdentity> => {
    if (!identity) throw new Error('No active identity')
    const status = await continuityVaultStatus(identity)
    if (!status.ready) {
      throw new Error('Restore local continuity files before editing the skills tree')
    }
    return identity
  }

  const mutateSkillsTree = async (args: {
    backStep: Step
    run: (id: EthagentIdentity) => Promise<string>
    successStep?: (notice: string) => Step
  }): Promise<void> => {
    try {
      const id = await requireReadyVault()
      const notice = await args.run(id)
      invalidateSkillsCache(id)
      await syncAgentCardManifest(id)
      const next = args.successStep
        ? args.successStep(notice)
        : { kind: 'continuity-skills-tree' as const, notice }
      setStep(next)
    } catch (err: unknown) {
      handleStepError(err, args.backStep)
    }
  }

  const openContinuityFile = async (kind: 'soul' | 'memory' | 'skills'): Promise<void> => {
    if (!identity) return
    const returnKind: 'continuity-private' | 'continuity-skills-tree' = kind === 'skills'
      ? 'continuity-skills-tree'
      : 'continuity-private'
    try {
      if (kind === 'skills') {
        await ensureAgentCardFile(identity, {
          fallback: () => readPublishedAgentCard(identity),
        })
      }
      const ref = continuityVaultRef(identity)
      const file = kind === 'soul' ? ref.soulPath : kind === 'memory' ? ref.memoryPath : ref.agentCardPath
      const result = await openFileInEditor(file)
      if (result.ok) {
        setStep({ kind: returnKind, editorOpened: true })
      } else {
        setStep({ kind: returnKind, notice: `open failed: ${result.error}`, editorOpened: false })
      }
    } catch (err: unknown) {
      handleStepError(err, { kind: returnKind })
    }
  }

  const openSkillFile = async (relativePath: string): Promise<void> => {
    if (!identity) return
    try {
      const skill = await readSkillByRelativePath(identity, relativePath)
      const result = await openFileInEditor(skill.absolutePath)
      invalidateSkillsCache(identity)
      try {
        await syncAgentCardManifest(identity)
      } catch (syncErr: unknown) {
        const failPrefix = result.ok ? '' : `open failed: ${result.error}; `
        setStep({ kind: 'continuity-skills-tree', notice: `${failPrefix}agent card update failed: ${(syncErr as Error).message}`, editorOpened: result.ok })
        return
      }
      if (result.ok) {
        setStep({ kind: 'continuity-skills-tree', editorOpened: true })
      } else {
        setStep({ kind: 'continuity-skills-tree', notice: `open failed: ${result.error}`, editorOpened: false })
      }
    } catch (err: unknown) {
      handleStepError(err, { kind: 'continuity-skills-tree' })
    }
  }

  const openSkillsFolder = async (): Promise<void> => {
    if (!identity) return
    try {
      const ref = continuityVaultRef(identity)
      const result = await openInFileManager(ref.skillsDir)
      if (result.ok) {
        setStep({ kind: 'continuity-skills-tree', editorOpened: true })
      } else {
        setStep({ kind: 'continuity-skills-tree', notice: `open failed: ${result.error}`, editorOpened: false })
      }
    } catch (err: unknown) {
      handleStepError(err, { kind: 'continuity-skills-tree' })
    }
  }

  const createSkill = async (name: string, visibility: SkillVisibility): Promise<void> => {
    const normalizedName = sanitizeSkillSegment(name)
    if (!normalizedName) {
      handleStepError(
        new Error('Folder name must contain only letters, numbers, dashes, underscores, or dots'),
        { kind: 'continuity-skill-new' },
      )
      return
    }
    try {
      const id = await requireReadyVault()
      const created = await createSkillFile(id, { name: normalizedName, visibility })
      invalidateSkillsCache(id)
      await syncAgentCardManifest(id)
      const result = await openFileInEditor(created.absolutePath)
      if (result.ok) {
        setStep({ kind: 'continuity-skills-tree', editorOpened: true })
      } else {
        setStep({ kind: 'continuity-skills-tree', notice: `created ${created.relativePath}; open failed: ${result.error}`, editorOpened: false })
      }
    } catch (err: unknown) {
      handleStepError(err, { kind: 'continuity-skill-new' })
    }
  }

  const deleteSkill = async (relativePath: string): Promise<void> => {
    await mutateSkillsTree({
      backStep: { kind: 'continuity-skills-tree' },
      run: async id => {
        await deleteSkillEntry(id, relativePath)
        return `deleted ${relativePath}`
      },
    })
  }

  const setSkillVisibility = async (
    relativePath: string,
    visibility: SkillVisibility,
  ): Promise<void> => {
    await mutateSkillsTree({
      backStep: { kind: 'continuity-skill-actions', relativePath },
      successStep: notice => ({ kind: 'continuity-skill-actions', relativePath, notice }),
      run: async id => {
        await setSkillVisibilityStorage(id, relativePath, visibility)
        const display = relativePath.split('/')[0] ?? relativePath
        return `${display} now ${visibility}`
      },
    })
  }

  return {
    continuityReady,
    setContinuityReady,
    workingStatus,
    openContinuityFile,
    openSkillFile,
    openSkillsFolder,
    createSkill,
    deleteSkill,
    setSkillVisibility,
  }
}

export function sanitizeSkillSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

async function readPublishedAgentCard(identity: EthagentIdentity): Promise<string> {
  const cid = identity.agentCard?.cid
  if (!cid) throw new Error('No saved Agent Card CID')
  return new TextDecoder().decode(await catFromIpfs(
    identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
    cid,
  ))
}
