export const LARGE_PASTE_THRESHOLD = 800

export type PastedTextRef = {
  id: number
  content: string
}

export function normalizePastedText(text: string): string {
  return text
    .replaceAll('\x1b[200~', '')
    .replaceAll('\x1b[201~', '')
    .replace(/(^|\n)(?:\[?200~|\[?201~)(?=\n|$)/g, '$1')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function shouldCollapsePastedText(
  text: string,
  maxInlineLines: number,
  threshold = LARGE_PASTE_THRESHOLD,
): boolean {
  return text.length > threshold || countPastedTextLineBreaks(text) > maxInlineLines
}

export function countPastedTextLineBreaks(text: string): number {
  return (text.match(/\n/g) ?? []).length
}

export function formatPastedTextRef(id: number, chars: number): string {
  return `[Pasted Content ${chars} chars #${id}]`
}

export function expandPastedTextRefs(input: string, refs: Map<number, PastedTextRef>): string {
  const matches = [...input.matchAll(/\[Pasted Content (\d+) chars #(\d+)\]/g)]
  let expanded = input

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]!
    const id = Number(match[2])
    const ref = refs.get(id)
    if (!ref) continue
    expanded =
      expanded.slice(0, match.index) +
      ref.content +
      expanded.slice((match.index ?? 0) + match[0].length)
  }

  return expanded
}
