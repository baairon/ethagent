import type { IpfsReadProgress } from '../../storage/ipfsRead.js'
import type { RestoreProgress } from '../shared/effects/types.js'

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024)
  return value >= 10 ? value.toFixed(0) : value.toFixed(1)
}

export function downloadProgress(progress: IpfsReadProgress): RestoreProgress {
  const amount = progress.total && progress.total >= progress.bytes
    ? `${megabytes(progress.bytes)} of ${megabytes(progress.total)} MB`
    : `${megabytes(progress.bytes)} MB`
  return {
    phase: 'downloading',
    label: `Downloading… ${amount}`,
    detail: `Downloading the encrypted snapshot from ${progress.host}.`,
  }
}
