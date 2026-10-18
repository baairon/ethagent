import { loadConfig, type EthagentIdentity } from '../storage/config.js'
import { getIdentityStatus } from '../storage/identity.js'
import { detectSyncTargets } from './sync.js'
import { continuityVaultRef } from '../identity/continuity/storage.js'
import { continuityWorkingTreeStatus } from '../identity/continuity/storage/status.js'
import { listPublishedContinuitySnapshots } from '../identity/continuity/snapshots.js'
import { changedContinuitySnapshotFiles } from '../identity/manager/continuity/state.js'
import { listSkills } from '../identity/continuity/skills/loadSkills.js'
import { daemonDisabled, daemonStatus, isPaused } from './daemon.js'
import { selectMirrorSkills } from './sync.js'
import { skippedSkillFolders } from './syncAdapters/shared.js'
import { formatSyncIssue, readSyncHealth } from './syncHealth.js'

function shortAddr(addr: string | undefined): string {
  if (!addr) return ''
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function networkName(chainId: number | undefined): string | null {
  if (chainId === 1) return 'mainnet'
  if (chainId === 8453) return 'base'
  return null
}

export async function runStatus(version: string): Promise<number> {
  const config = await loadConfig().catch(() => null)
  const status = await getIdentityStatus(config ?? undefined).catch(() => null)
  if (!status?.address) {
    process.stdout.write(`ethagent v${version} · no identity yet\n`)
    return 0
  }
  const bits: string[] = [`ethagent v${version}`]
  if (status.agentId) bits.push(`#${status.agentId}`)
  const network = networkName(status.chainId)
  if (network) bits.push(network)
  bits.push(shortAddr(status.address))
  const localChanges = config?.identity ? await localChangesSegment(config.identity) : null
  if (localChanges) bits.push(localChanges)
  process.stdout.write(bits.join(' · ') + '\n')
  let detectionFailed = false
  if (config?.identity) {
    process.stdout.write(`vault: ${continuityVaultRef(config.identity).dir}\n`)
    const detectionErrors: string[] = []
    const targets = await detectSyncTargets(undefined, (adapter, err) => {
      detectionErrors.push(`${adapter.name}: ${err.message}`)
    })
    process.stdout.write(`wired into: ${targets.length ? targets.map(t => t.name).join(', ') : 'none detected yet'}\n`)
    for (const error of detectionErrors) process.stdout.write(`harness detection failed: ${error}\n`)
    detectionFailed = detectionErrors.length > 0
    const daemon = daemonStatus()
    const background = isPaused()
      ? 'paused'
      : daemonDisabled()
        ? 'disabled'
        : daemon.running
          ? `running (pid ${daemon.pid})`
          : 'not running (start with: ethagent --ensure-daemon)'
    process.stdout.write(`background sync: ${background}\n`)
    const health = await readSyncHealth(config.identity)
    if (!health) {
      process.stdout.write('last sync: never checked (run: ethagent sync)\n')
    } else if (health.state === 'no-targets') {
      process.stdout.write(`last sync: no harness detected (${health.attemptedAt})\n`)
    } else if (health.state === 'ok') {
      process.stdout.write(`last sync: complete (${health.attemptedAt})\n`)
    } else {
      const previous = health.lastSuccessAt ? `; last complete ${health.lastSuccessAt}` : ''
      process.stdout.write(`last sync: incomplete (${health.attemptedAt}${previous}; run: ethagent sync)\n`)
      for (const issue of health.issues) process.stdout.write(`  ${formatSyncIssue(issue)}\n`)
    }
    try {
      const names = selectMirrorSkills(await listSkills(config.identity)).map(skill => skill.name)
      const seen = new Set<string>()
      for (const adapter of targets) {
        for (const dir of await adapter.skillsDirs?.() ?? []) {
          if (seen.has(dir)) continue
          seen.add(dir)
          const skipped = await skippedSkillFolders(dir, names)
          if (skipped.length > 0) {
            process.stdout.write(`skills not mirrored into ${dir}: ${skipped.join(', ')} (a folder that isn't ethagent's has that name; move or delete it)\n`)
          }
        }
      }
    } catch (err) {
      process.stderr.write(`ethagent: could not check skipped skill folders: ${(err as Error).message}\n`)
      return 1
    }
  }
  return detectionFailed ? 1 : 0
}

async function localChangesSegment(identity: EthagentIdentity): Promise<string | null> {
  try {
    const [latest] = await listPublishedContinuitySnapshots(identity, 1)
    const status = await continuityWorkingTreeStatus(identity, latest)
    if (status.publishState !== 'local-changes') return null
    const files = changedContinuitySnapshotFiles(status)
    return files.length > 0 ? `local-changes: ${files.join(', ')}` : 'local-changes'
  } catch {
    return null
  }
}
