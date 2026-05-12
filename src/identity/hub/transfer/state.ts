import type { EthagentIdentity, TransferSnapshotMetadata } from '../../../storage/config.js'

export type TransferSnapshotView =
  | {
      kind: 'ready-to-transfer'
      sender: string
      receiver: string
      receiverHandle?: string
      slotCount: number
    }
  | {
      kind: 'received'
      sender: string
      receiver: string
      receiverHandle?: string
      slotCount: number
    }
  | null

export function transferSnapshotView(identity?: EthagentIdentity | null): TransferSnapshotView {
  const snapshot = identity?.backup?.transferSnapshot
  if (!identity || !isDualWalletTransferSnapshot(snapshot)) return null
  const owner = identity.ownerAddress ?? identity.address
  if (!owner) return null
  const ownerKey = owner.toLowerCase()
  const senderKey = snapshot.senderAddress.toLowerCase()
  const receiverKey = snapshot.receiverAddress.toLowerCase()
  if (snapshot.slotCount < 2) return null
  if (ownerKey === senderKey) {
    return {
      kind: 'ready-to-transfer',
      sender: snapshot.senderAddress,
      receiver: snapshot.receiverAddress,
      ...(snapshot.receiverHandle ? { receiverHandle: snapshot.receiverHandle } : {}),
      slotCount: snapshot.slotCount,
    }
  }
  if (ownerKey === receiverKey) {
    return {
      kind: 'received',
      sender: snapshot.senderAddress,
      receiver: snapshot.receiverAddress,
      ...(snapshot.receiverHandle ? { receiverHandle: snapshot.receiverHandle } : {}),
      slotCount: snapshot.slotCount,
    }
  }
  return null
}

function isDualWalletTransferSnapshot(value: unknown): value is TransferSnapshotMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<TransferSnapshotMetadata>
  return snapshot.kind === 'dual-wallet'
    && typeof snapshot.senderAddress === 'string'
    && typeof snapshot.receiverAddress === 'string'
    && typeof snapshot.slotCount === 'number'
}
