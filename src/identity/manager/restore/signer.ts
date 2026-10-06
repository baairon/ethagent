import { getAddress, type Address, type Hex } from 'viem'
import type { ContinuitySnapshotEnvelope, ContinuitySnapshotPayload } from '../../continuity/envelope.js'
import { decryptWithSigner, signatureVariants, type ChallengeSigner } from '../../continuity/localKeyDecrypt.js'
import type { BrowserWalletSignature, SignatureRequest } from '../../wallet/browserWallet.js'

// Who answers a restore's decrypt challenge. The manager asks the browser wallet in a
// tab of its own; headless commands pass one wallet session for the whole command, or
// the operator key, which signs locally and never opens a browser.
export type RestoreSigner =
  | { kind: 'browser'; requestSignature: (req: SignatureRequest) => Promise<BrowserWalletSignature> }
  | { kind: 'local'; signer: ChallengeSigner }

const LOCK_WORDS: Record<string, string> = {
  'no-slot': 'this snapshot has no restore slot for the operator key',
  'signature-mismatch': 'the operator key did not open this snapshot',
  'transfer-parties-only': 'this transfer snapshot opens only for its sender and receiver',
  'owner-only': 'this snapshot opens only with the owner wallet',
}

export class RestoreLockedError extends Error {
  constructor(readonly reason: string, readonly signer: Address, readonly slots?: string[]) {
    super(`${LOCK_WORDS[reason] ?? reason} (${signer})${slots?.length ? `; it opens for ${slots.join(', ')}` : ''}.`)
    this.name = 'RestoreLockedError'
  }
}

// Opens a continuity snapshot with the operator key, trying both signature v-byte
// forms as the history fetch does.
export async function decryptContinuityWithLocalSigner(
  envelope: ContinuitySnapshotEnvelope,
  signer: ChallengeSigner,
): Promise<{ account: Address; payload: ContinuitySnapshotPayload }> {
  const result = await decryptWithSigner(envelope, signer)
  if (!result.ok) throw new RestoreLockedError(result.reason, getAddress(signer.address), result.slots)
  return { account: getAddress(signer.address), payload: result.payload }
}

// Signs a legacy owner-only challenge locally, returning the first v-byte form the
// caller's check accepts.
export async function signLegacyChallengeLocally<T>(
  signer: ChallengeSigner,
  challenge: string,
  open: (signature: Hex) => T,
): Promise<{ account: Address; value: T }> {
  const signature = await signer.sign(challenge)
  let lastError: unknown
  for (const variant of signatureVariants(signature)) {
    try {
      return { account: getAddress(signer.address), value: open(variant as Hex) }
    } catch (err: unknown) {
      lastError = err
    }
  }
  throw lastError ?? new RestoreLockedError('signature-mismatch', getAddress(signer.address))
}
