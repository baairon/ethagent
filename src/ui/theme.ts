export const palette: Array<[number, number, number]> = [
  [0xff, 0xff, 0xff],
  [0xf2, 0xf9, 0xf4],
  [0xe7, 0xf4, 0xec],
  [0xd4, 0xee, 0xdd],
  [0xe7, 0xf4, 0xec],
  [0xff, 0xff, 0xff],
]

export const eyePalette: Array<[number, number, number]> = [
  [0xf5, 0xd8, 0xd8],
  [0xf5, 0xe7, 0xcf],
  [0xf5, 0xf0, 0xd4],
  [0xd4, 0xee, 0xdd],
  [0xd4, 0xe6, 0xf5],
] as const

export const theme = {
  accentPrimary: '#d4eedd',
  accentWarm: '#d8cda8',
  accentNeutral: '#e4e3b5',
  accentSecondary: '#c0e3cb',
  accentMint: '#e7f4ec',
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

export function eyeGradientColor(t: number): string {
  const s = Math.max(0, Math.min(1, t)) * (eyePalette.length - 1)
  const i = Math.min(Math.floor(s), eyePalette.length - 2)
  const f = s - i
  const lo = eyePalette[i] ?? eyePalette[0]!
  const hi = eyePalette[i + 1] ?? eyePalette[eyePalette.length - 1]!
  const [r1, g1, b1] = lo
  const [r2, g2, b2] = hi
  const r = Math.round(r1 + (r2 - r1) * f)
  const g = Math.round(g1 + (g2 - g1) * f)
  const b = Math.round(b1 + (b2 - b1) * f)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
