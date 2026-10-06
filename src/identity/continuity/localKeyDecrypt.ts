import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js'
import { addressFromPrivateKey, signMessage } from '../crypto/eth.js'
import { deriveWalletRestoreKemSeed, fromBase64, toBase64 } from './envelopeCrypto.js'
import {
  isTransferContinuitySnapshotEnvelope,
  isWalletContinuitySnapshotEnvelope,
  restoreContinuitySnapshotEnvelope,
} from './envelopeParse.js'
import type {
  ContinuitySnapshotEnvelope,
  ContinuitySnapshotPayload,
  WalletContinuitySnapshotSlot,
} from './envelopeTypes.js'
import type { LockReason } from './snapshotStore.js'

export type LocalDecrypt =
  | { ok: true; payload: ContinuitySnapshotPayload; via: 'wallet-slot' | 'owner-signature' | 'transfer-slot' }
  | { ok: false; reason: LockReason; slots?: string[] }

export type ChallengeSigner = {
  address: string
  sign: (challenge: string) => Promise<string>
}

export function localKeySigner(privateKey: string): ChallengeSigner {
  const cache = new Map<string, string>()
  return {
    address: addressFromPrivateKey(privateKey),
    sign: async challenge => {
      const cached = cache.get(challenge)
      if (cached) return cached
      const signature = signMessage(privateKey, challenge)
      cache.set(challenge, signature)
      return signature
    },
  }
}

export function signatureVariants(signature: string): string[] {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return [signature]
  const v = Number.parseInt(signature.slice(130), 16)
  const alternate = v >= 27 ? v - 27 : v + 27
  if (alternate < 0 || alternate > 255) return [signature]
  return [signature, `${signature.slice(0, 130)}${alternate.toString(16).padStart(2, '0')}`]
}

export function walletSlotMatchesSignature(slot: WalletContinuitySnapshotSlot, signature: string): boolean {
  try {
    const seed = deriveWalletRestoreKemSeed(signature, fromBase64(slot.salt), slot.address, slot.challenge)
    return toBase64(ml_kem1024.keygen(seed).publicKey) === slot.kemPublicKey
  } catch {
    return false
  }
}

export async function decryptWithSigner(envelope: ContinuitySnapshotEnvelope, signer: ChallengeSigner): Promise<LocalDecrypt> {
  const me = signer.address.toLowerCase()
  if (isWalletContinuitySnapshotEnvelope(envelope)) {
    const slots = envelope.slots.map(slot => slot.address)
    const slot = envelope.slots.find(candidate => candidate.address.toLowerCase() === me)
    if (!slot) return { ok: false, reason: 'no-slot', slots }
    const signature = await signer.sign(slot.challenge)
    const match = signatureVariants(signature).find(variant => walletSlotMatchesSignature(slot, variant))
    if (!match) return { ok: false, reason: 'signature-mismatch', slots }
    const payload = restoreContinuitySnapshotEnvelope({ envelope, walletSignature: match, currentOwnerAddress: signer.address })
    return { ok: true, payload, via: 'wallet-slot' }
  }
  if (isTransferContinuitySnapshotEnvelope(envelope)) {
    const parties = [envelope.slots.owner, envelope.slots.target]
    const slot = parties.find(candidate => candidate.address.toLowerCase() === me)
    if (!slot) return { ok: false, reason: 'transfer-parties-only', slots: parties.map(party => party.address) }
    const signature = await signer.sign(slot.challenge)
    for (const variant of signatureVariants(signature)) {
      try {
        const payload = restoreContinuitySnapshotEnvelope({ envelope, walletSignature: variant, currentOwnerAddress: signer.address })
        return { ok: true, payload, via: 'transfer-slot' }
      } catch {
        continue
      }
    }
    return { ok: false, reason: 'signature-mismatch' }
  }
  if (envelope.ownerAddress.toLowerCase() !== me) return { ok: false, reason: 'owner-only', slots: [envelope.ownerAddress] }
  const signature = await signer.sign(envelope.challenge)
  for (const variant of signatureVariants(signature)) {
    try {
      const payload = restoreContinuitySnapshotEnvelope({ envelope, walletSignature: variant, currentOwnerAddress: signer.address })
      return { ok: true, payload, via: 'owner-signature' }
    } catch {
      continue
    }
  }
  return { ok: false, reason: 'signature-mismatch' }
}
