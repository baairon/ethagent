import { loadConfig, type EthagentIdentity } from '../storage/config.js'
import { getIdentityStatus } from '../storage/identity.js'
import { detectSyncTargets } from './sync.js'
import { continuityWorkingTreeStatus } from '../identity/continuity/storage/status.js'
import { listPublishedContinuitySnapshots } from '../identity/continuity/snapshots.js'
import { changedContinuitySnapshotFiles } from '../identity/manager/continuity/state.js'

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
  if (config?.identity) {
    const names = (await detectSyncTargets().catch(() => [])).map(t => t.name)
    process.stdout.write(`wired into: ${names.length ? names.join(', ') : 'none detected yet'}\n`)
  }
  return 0
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
