export const palette: Array<[number, number, number]> = [
  [0xf5, 0xd0, 0xda],
  [0xf5, 0xd8, 0xc2],
  [0xf4, 0xe6, 0xb8],
  [0xc8, 0xe8, 0xce],
  [0xc4, 0xdc, 0xf0],
  [0xd8, 0xc8, 0xf0],
  [0xf5, 0xd0, 0xda],
]

export const theme = {
  accentPeriwinkle: '#f0eee8',
  accentBlue: '#dde4f0',
  accentWhite: '#f8f6f2',
  accentError: '#e8b8b8',
  wordmarkEth: '#9aa0b0',
  menuShortcut: '#8a8a9c',
  menuStatus: '#7a8090',
  border: '#3a3f4f',
  dim: '#7a8090',
  text: '#dadce6',
  textSubtle: '#9aa0b0',
} as const

export const PANEL_WIDTH = 46

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}

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

