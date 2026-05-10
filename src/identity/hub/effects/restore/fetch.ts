import { catFromIpfs } from '../../../storage/ipfs.js'
import type { Step } from '../../identityHubReducer.js'
import type { EffectCallbacks } from '../types.js'
import { parseRestorableEnvelope } from './envelopes.js'
import { assertCandidateCanReadEnvelope, restoreSignatureRequestForStep } from './auth.js'

export async function runRestoreFetch(
  step: Extract<Step, { kind: 'restore-fetching' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const raw = await catFromIpfs(step.apiUrl, step.cid)
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
  callbacks.onStep(nextStep)
}
