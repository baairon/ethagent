import { formatEther } from 'viem'

export function uniqueStrings(values: string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim().replace(/\/$/, '')
    if (normalized && !out.includes(normalized)) out.push(normalized)
  }
  return out
}

export function cleanRpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message
    .replace(/s+/g, ' ')
    .slice(0, 220)
}

export function formatEthAmount(wei: bigint): string {
  const [whole = '0', fraction = ''] = formatEther(wei).split('.')
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, '')
  return trimmedFraction ? whole + '.' + trimmedFraction : whole
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Agent token URI must resolve to a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function decodeDataUri(uri: string): string {
  const comma = uri.indexOf(',')
  if (comma === -1) throw new Error('Invalid data URI')
  const meta = uri.slice(0, comma)
  const body = uri.slice(comma + 1)
  return meta.endsWith(';base64')
    ? Buffer.from(body, 'base64').toString('utf8')
    : decodeURIComponent(body)
}

export async function mapWithConcurrency<input, output>(
  inputs: input[],
  concurrency: number,
  mapper: (input: input) => Promise<output>,
): Promise<output[]> {
  const out: output[] = new Array(inputs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++
      out[index] = await mapper(inputs[index]!)
    }
  })
  await Promise.all(workers)
  return out
}
