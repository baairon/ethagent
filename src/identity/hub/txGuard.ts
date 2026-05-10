export type TxGuardKind =
  | 'rebackup'
  | 'public-profile'
  | 'vault-deploy'
  | 'vault-deposit'
  | 'vault-unwrap'
  | 'vault-withdraw'

export class TxGuardBusyError extends Error {
  readonly kind: TxGuardKind
  constructor(kind: TxGuardKind, message: string) {
    super(message)
    this.name = 'TxGuardBusyError'
    this.kind = kind
  }
}

const inFlight = new Set<TxGuardKind>()

export function isTxGuardBusy(kind: TxGuardKind): boolean {
  return inFlight.has(kind)
}

export function acquireTxGuard(kind: TxGuardKind): void {
  inFlight.add(kind)
}

export function releaseTxGuard(kind: TxGuardKind): void {
  inFlight.delete(kind)
}

export function resetTxGuardForTest(): void {
  inFlight.clear()
}

export function txGuardBusyMessage(kind: TxGuardKind): string {
  switch (kind) {
    case 'rebackup':
      return 'A snapshot save is already in flight. Wait for it to complete before retrying.'
    case 'public-profile':
      return 'A public profile update is already in flight. Wait for it to complete before retrying.'
    case 'vault-deploy':
      return 'A vault deploy transaction is already in flight. Wait for it to complete before retrying.'
    case 'vault-deposit':
      return 'A vault deposit transaction is already in flight. Wait for it to complete before retrying.'
    case 'vault-unwrap':
      return 'A vault unwrap transaction is already in flight. Wait for it to complete before retrying.'
    case 'vault-withdraw':
      return 'A token withdraw transaction is already in flight. Wait for it to complete before retrying.'
  }
}
