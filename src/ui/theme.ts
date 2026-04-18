export const palette: Array<[number, number, number]> = [
  [0xbc, 0xd9, 0xc9],
  [0xcf, 0xe5, 0xbd],
  [0xe4, 0xe3, 0xb5],
  [0xe7, 0xcd, 0xb7],
  [0xd9, 0xca, 0xe8],
  [0x9f, 0xd0, 0xbb],
  [0x90, 0xb8, 0xe8],
]

export const theme = {
  accentPrimary: '#cfe5bd',
  accentWarm: '#d8cda8',
  accentNeutral: '#e4e3b5',
  accentSecondary: '#9fd0bb',
  accentMint: '#bcd9c9',
  accentPeach: '#e7cdb7',
  accentLavender: '#d9cae8',
  accentInfo: '#90b8e8',
  border: '#555555',
  dim: '#777777',
  text: '#f1f1f1',
  textSubtle: '#9b9b9b',
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
