export const palette: Array<[number, number, number]> = [
  [0xe8, 0xa0, 0xa0],
  [0xe8, 0xbe, 0x8f],
  [0xe8, 0xdf, 0x9a],
  [0x96, 0xd4, 0xa8],
  [0x90, 0xb8, 0xe8],
]

export const theme = {
  accentPrimary: '#e8a0a0',
  accentWarm: '#e8be8f',
  accentNeutral: '#e8df9a',
  accentSecondary: '#96d4a8',
  accentInfo: '#90b8e8',
  border: '#555555',
  dim: '#777777',
  text: '#cccccc',
} as const

export function gradientColor(t: number): string {
  const s = Math.max(0, Math.min(1, t)) * (palette.length - 1)
  const i = Math.min(Math.floor(s), palette.length - 2)
  const f = s - i
  const lo = palette[i] ?? palette[0]!
  const hi = palette[i + 1] ?? palette[palette.length - 1]!
  const [r1, g1, b1] = lo
  const [r2, g2, b2] = hi
  const r = Math.round(r1 + (r2 - r1) * f)
  const g = Math.round(g1 + (g2 - g1) * f)
  const b = Math.round(b1 + (b2 - b1) * f)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
