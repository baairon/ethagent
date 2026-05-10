export function shortCid(cid: string): string {
  if (cid.length <= 18) return cid
  return `${cid.slice(0, 10)}...${cid.slice(-6)}`
}

export function shortAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function formatDate(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  return date.toISOString().slice(0, 10)
}
