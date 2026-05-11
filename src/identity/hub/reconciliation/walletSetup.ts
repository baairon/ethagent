import { getAddress, type Address } from 'viem'

export type ApprovalDiff = {
  added: Address[]
  removed: Address[]
}

export function computeApprovalDiff(
  beforeApproved: ReadonlyArray<{ address: string }>,
  afterApproved: ReadonlyArray<{ address: string }>,
): ApprovalDiff {
  const before = new Set(beforeApproved.map(record => record.address.toLowerCase()))
  const after = new Set(afterApproved.map(record => record.address.toLowerCase()))
  const added: Address[] = []
  const removed: Address[] = []
  for (const record of afterApproved) {
    if (!before.has(record.address.toLowerCase())) {
      added.push(getAddress(record.address))
    }
  }
  for (const record of beforeApproved) {
    if (!after.has(record.address.toLowerCase())) {
      removed.push(getAddress(record.address))
    }
  }
  return { added, removed }
}
