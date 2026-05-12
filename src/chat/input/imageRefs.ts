export type ImageRef = { path: string; mimeType?: string }

const IMAGE_REF_MARKER_RE = /\[Image\s+#(\d+)\]/g

export function expandImageRefs(text: string, refs: Map<number, ImageRef>): string {
  return text.replace(IMAGE_REF_MARKER_RE, (full, raw: string) => {
    const ref = refs.get(Number(raw))
    return ref ? `[image: ${ref.path}]` : full
  })
}

export function referencedImageIds(text: string): Set<number> {
  const out = new Set<number>()
  for (const match of text.matchAll(IMAGE_REF_MARKER_RE)) {
    const id = Number(match[1])
    if (Number.isFinite(id)) out.add(id)
  }
  return out
}

export function pruneImageRefs(refs: Map<number, ImageRef>, text: string): void {
  const referenced = referencedImageIds(text)
  for (const id of [...refs.keys()]) {
    if (!referenced.has(id)) refs.delete(id)
  }
}

export function formatImageRefMarker(id: number): string {
  return `[Image #${id}]`
}
