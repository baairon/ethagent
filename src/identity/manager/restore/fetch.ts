import { catFromIpfs } from '../../storage/ipfs.js'
import type { Step } from '../reducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { parseRestorableEnvelope } from './envelopes.js'
import { assertCandidateCanReadEnvelope, restoreSignatureRequestForStep } from './auth.js'
import { downloadProgress } from './progress.js'

export async function runRestoreFetch(
  step: Extract<Step, { kind: 'restore-fetching' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const signal = callbacks.signal
  const raw = await catFromIpfs(step.apiUrl, step.cid, fetch, {
    ...(signal ? { signal } : {}),
    onProgress: progress => callbacks.onRestoreProgress?.(downloadProgress(progress)),
  })
  if (signal?.aborted) return
  const envelope = parseRestorableEnvelope(raw)
  assertCandidateCanReadEnvelope(step.candidate, step.requesterAddress, envelope)
  const nextStep: Extract<Step, { kind: 'restore-authorizing' }> = {
    kind: 'restore-authorizing',
    cid: step.cid,
    apiUrl: step.apiUrl,
    envelope,
    candidate: step.candidate,
    requesterAddress: step.requesterAddress,
    purpose: step.purpose,
  }
  restoreSignatureRequestForStep(nextStep)
  callbacks.onRestoreProgress?.(null)
  callbacks.onStep(nextStep)
}
