import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import type { EthagentIdentity } from '../../storage/config.js'
import { continuityVaultRef } from '../../identity/continuity/storage/paths.js'
import { readVaultRawFiles } from '../../identity/continuity/snapshotCapture.js'
import { putCheckpoint, withStoreLock, type CheckpointManifest } from '../../identity/continuity/snapshotStore.js'
import { invalidateSkillsCache } from '../../identity/continuity/skills/loadSkills.js'
import { isBuildCacheName, isWithin } from '../../identity/continuity/skills/skillPaths.js'
import { pathMatches, sha256Bytes } from '../../identity/continuity/diff/treeDiff.js'
import { AGENT_CARD_PATH, SKILLS_PREFIX } from '../../identity/continuity/storage/packed.js'
import { pullHarnessSoulMemoryIntoVault, pushVaultSoulMemoryToHarness } from '../sync.js'
import { loadHistoryContext, loadTree, refJson, resolveRef, type HistoryContext, type ResolvedRef } from './refs.js'
import {
  emitJson,
  failFrom,
  HistoryError,
  parseHistoryArgs,
  requireIdentity,
  stringValues,
  type HistoryDeps,
} from './shared.js'

export const ROLLBACK_USAGE = 'ethagent rollback <ref> [--file PATH]... [--yes] [--json]  |  ethagent rollback --undo [--yes] [--json]'

type Action = { path: string; action: 'write' | 'create' | 'delete' }

type Skip = { path: string; reason: string }

type Planned = {
  target: Exclude<ResolvedRef, { kind: 'working' }>
  targetFiles: Record<string, Uint8Array>
  current: Record<string, Uint8Array>
  actions: Action[]
  skipped: Skip[]
  pendingPull: string[]
}

export type RollbackDeps = {
  pull: (identity: EthagentIdentity) => Promise<string[]>
  push: (identity: EthagentIdentity) => Promise<void>
}

const defaultRollbackDeps: RollbackDeps = {
  pull: pullHarnessSoulMemoryIntoVault,
  push: pushVaultSoulMemoryToHarness,
}

function vaultPathFor(identity: EthagentIdentity, key: string): string {
  const ref = continuityVaultRef(identity)
  if (key === 'SOUL.md') return ref.soulPath
  if (key === 'MEMORY.md') return ref.memoryPath
  if (!key.startsWith(SKILLS_PREFIX)) throw new HistoryError(1, `refusing to write ${key}: only SOUL.md, MEMORY.md, and skills/ are restorable`)
  const rel = key.slice(SKILLS_PREFIX.length)
  const segments = rel.split('/')
  if (segments.length < 2 || segments.some(segment => !segment || segment.startsWith('.') || segment.includes('\0'))) {
    throw new HistoryError(1, `refusing to write unsafe path ${key}`)
  }
  const absolute = path.resolve(ref.skillsDir, ...segments)
  if (!isWithin(ref.skillsDir, absolute)) throw new HistoryError(1, `refusing to write ${key}: it escapes the vault`)
  return absolute
}

async function removeEmptyParents(dir: string, stopAt: string): Promise<void> {
  let current = dir
  while (isWithin(stopAt, current) && path.resolve(current) !== path.resolve(stopAt)) {
    const rest = await fs.readdir(current).catch(() => null)
    if (!rest || rest.length > 0) return
    await fs.rmdir(current).catch(() => undefined)
    current = path.dirname(current)
  }
}

function undoTarget(ctx: HistoryContext): ResolvedRef {
  const checkpoint = ctx.checkpoints.find(cp => cp.reason === 'pre-rollback' || cp.reason === 'pre-restore')
  if (!checkpoint) throw new HistoryError(1, 'nothing to undo: no rollback or restore has been recorded yet')
  return { kind: 'checkpoint', label: `cp:${checkpoint.id}`, checkpoint }
}

async function planRollback(
  identity: EthagentIdentity,
  deps: HistoryDeps,
  request: { ref: string | null; filters: string[] },
): Promise<Planned> {
  const ctx = await loadHistoryContext(identity, deps)
  const target = request.ref === null ? undoTarget(ctx) : resolveRef(request.ref, ctx)
  if (target.kind === 'working') throw new HistoryError(2, 'working is already the current state; pick a snapshot or checkpoint')
  const tree = await loadTree(ctx, target)
  const view = await ctx.working()
  const current = await readVaultRawFiles(identity)
  const pathScoped = target.kind === 'checkpoint' && target.checkpoint.scope === 'paths'
  const targetFiles = Object.fromEntries(Object.entries(tree.files).filter(([key]) => key !== AGENT_CARD_PATH))
  const touchesSkills = pathScoped
    || Object.keys(targetFiles).some(key => key.startsWith(SKILLS_PREFIX))
    || request.filters.some(filter => filter === 'skills' || filter.startsWith(SKILLS_PREFIX))
  const inScope = (key: string): boolean =>
    key !== AGENT_CARD_PATH
    && pathMatches(key, request.filters)
    && (touchesSkills || !key.startsWith(SKILLS_PREFIX))
    && !key.split('/').some(isBuildCacheName)
  const candidates = pathScoped
    ? new Set([...Object.keys(targetFiles), ...(target.kind === 'checkpoint' ? target.checkpoint.absent : [])])
    : new Set([...Object.keys(targetFiles), ...Object.keys(view.files).filter(key => key in current)])
  const actions: Action[] = []
  const skipped: Skip[] = []
  for (const key of [...candidates].sort()) {
    if (!inScope(key)) continue
    const want = targetFiles[key]
    const have = current[key]
    if (want && have && sha256Bytes(want) === sha256Bytes(have)) continue
    if (!want && !have) continue
    if (have && view.lossy.includes(key)) {
      skipped.push({ path: key, reason: 'the working file is not valid UTF-8, so it is left alone' })
      continue
    }
    if (tree.forgotten.includes(key)) {
      skipped.push({ path: key, reason: 'forgotten from local history' })
      continue
    }
    actions.push({ path: key, action: !want ? 'delete' : have ? 'write' : 'create' })
  }
  for (const forgotten of tree.forgotten) {
    if (inScope(forgotten) && !skipped.some(item => item.path === forgotten)) skipped.push({ path: forgotten, reason: 'forgotten from local history' })
  }
  return { target, targetFiles, current, actions, skipped, pendingPull: view.pendingPull }
}

async function applyRollback(identity: EthagentIdentity, planned: Planned): Promise<CheckpointManifest> {
  const saved: Record<string, Uint8Array> = {}
  const absent: string[] = []
  for (const action of planned.actions) {
    const before = planned.current[action.path]
    if (before) saved[action.path] = before
    else absent.push(action.path)
  }
  const checkpoint = await putCheckpoint(identity, {
    reason: 'pre-rollback',
    scope: 'paths',
    files: saved,
    absent,
    target: planned.target.label,
  })
  const ref = continuityVaultRef(identity)
  for (const action of planned.actions) {
    const file = vaultPathFor(identity, action.path)
    if (action.action === 'delete') {
      await fs.rm(file, { force: true })
      await removeEmptyParents(path.dirname(file), ref.skillsDir)
      continue
    }
    const bytes = planned.targetFiles[action.path]!
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await atomicWriteText(file, bytes, { mode: 0o600 })
    const reread = await fs.readFile(file)
    if (sha256Bytes(reread) !== sha256Bytes(bytes)) {
      throw new HistoryError(1, `verification failed after writing ${action.path}`, `undo with: ethagent rollback cp:${checkpoint.id} --yes`)
    }
  }
  return checkpoint
}

export async function runRollbackCommand(args: string[], deps: HistoryDeps, rollbackDeps: RollbackDeps = defaultRollbackDeps): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      file: { type: 'string', multiple: true },
      yes: { type: 'boolean' },
      undo: { type: 'boolean' },
    }, ROLLBACK_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${ROLLBACK_USAGE}\nputs the exact bytes of a snapshot or checkpoint back into the vault and your harness. previews by default; --yes applies. a checkpoint of everything it touches is taken first, so --undo reverses it. never touches the chain.\n`)
      return 0
    }
    if (values.undo ? positionals.length > 0 : positionals.length !== 1) {
      throw new HistoryError(2, values.undo ? '--undo takes no ref' : 'rollback needs exactly one ref', `usage: ${ROLLBACK_USAGE}`)
    }
    const filters = stringValues(values.file).map(filter => filter.replace(/\\/g, '/').replace(/\/+$/, ''))
    if (filters.some(filter => filter === AGENT_CARD_PATH)) {
      throw new HistoryError(2, 'agent-card.json is rebuilt from your profile and public skills on every save, so it cannot be rolled back', 'roll back the skills instead')
    }
    const { identity } = await requireIdentity(deps)
    const request = { ref: values.undo ? null : positionals[0]!, filters }
    const summarize = (planned: Planned): Record<string, unknown> => ({
      target: refJson(planned.target),
      files: planned.actions,
      skipped: planned.skipped,
      pendingPull: planned.pendingPull,
    })
    if (!values.yes) {
      const planned = await planRollback(identity, deps, request)
      if (json) await emitJson(deps.io, { applied: false, ...summarize(planned) })
      else {
        const lines = [`rollback preview to ${planned.target.label}: ${planned.actions.length} change${planned.actions.length === 1 ? '' : 's'}`]
        for (const action of planned.actions) lines.push(`  ${action.action === 'delete' ? 'D' : action.action === 'create' ? 'A' : 'M'} ${action.path}`)
        for (const skip of planned.skipped) lines.push(`  skip ${skip.path}: ${skip.reason}`)
        if (planned.pendingPull.length > 0) lines.push(`  note: ${planned.pendingPull.join(', ')} has newer edits in a connected tool; they are pulled in first when you apply`)
        if (planned.actions.length > 0) lines.push('nothing was written. rerun with --yes to apply (a checkpoint is taken first, so it can be undone).')
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }
    const { planned, checkpoint } = await withStoreLock(identity, async () => {
      await rollbackDeps.pull(identity).catch(() => [])
      const planned = await planRollback(identity, deps, request)
      const checkpoint = planned.actions.length > 0 ? await applyRollback(identity, planned) : null
      return { planned, checkpoint }
    })
    if (!checkpoint) {
      if (json) await emitJson(deps.io, { applied: false, ...summarize(planned), note: 'already matches the target' })
      else await deps.io.out(`the vault already matches ${planned.target.label}\n`)
      return 0
    }
    invalidateSkillsCache(identity)
    await rollbackDeps.push(identity).catch(() => undefined)
    if (json) {
      await emitJson(deps.io, {
        applied: true,
        checkpoint: `cp:${checkpoint.id}`,
        ...summarize(planned),
        next: 'run `ethagent save` if this state should become the published snapshot',
      })
    } else {
      await deps.io.out(`rolled back ${planned.actions.length} file${planned.actions.length === 1 ? '' : 's'} to ${planned.target.label}. undo with: ethagent rollback --undo --yes\n`)
    }
    return planned.skipped.length > 0 ? 4 : 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
