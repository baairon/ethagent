export const palette: Array<[number, number, number]> = [
  [0xf3, 0xd8, 0xe0],
  [0xf3, 0xdf, 0xce],
  [0xf2, 0xec, 0xca],
  [0xd7, 0xed, 0xda],
  [0xd2, 0xe5, 0xf3],
  [0xe2, 0xd6, 0xf0],
  [0xf3, 0xd8, 0xe0],
]

export const theme = {
  accentPeriwinkle: '#f0eee8',
  accentBlue: '#dde4f0',
  accentWhite: '#f8f6f2',
  accentError: '#e8b8b8',
  accentHighlight: '#f0c8c8',
  wordmark: '#fafafa',
  wordmarkEth: '#9aa0b0',
  menuShortcut: '#8a8a9c',
  menuStatus: '#7a8090',
  modePlan: '#f0c7a8',
  modeAcceptEdits: '#c7b6f2',
  diffAdded: '#8fd49d',
  diffRemoved: '#d99898',
  diffAddedBackground: '#16351f',
  diffRemovedBackground: '#3a1717',
  blockBackground: '#0b0d12',
  codeKeyword: '#e8eefd',
  codeString: '#c9e08f',
  codeNumber: '#d8dcfa',
  codeComment: '#777777',
  codeFunction: '#8fc7ff',
  codeType: '#f2d087',
  codeBuiltin: '#b8a7ff',
  codeProperty: '#91dcc0',
  codeOperator: '#d8dcfa',
  codePunctuation: '#aeb4c8',
  codeTag: '#ffb3b3',
  codeAttribute: '#f2d087',
  border: '#3a3f4f',
  dim: '#7a8090',
  text: '#dadce6',
  textSubtle: '#9aa0b0',
} as const

export const PANEL_WIDTH = 48

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
