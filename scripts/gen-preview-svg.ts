import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { LINES, SPLIT, LEFT_DECOR, RIGHT_DECOR } from '../src/identity/manager/shared/components/Wordmark.js'
import { gradientColor, theme } from '../src/ui/theme.js'

const cellW = 9.0
const lineHeight = 18
const fontSize = 16
const leftPad = 16
const rightPad = 16
const topBaseline = 17
const bottomMargin = 10.5

const fontFamily =
  "ui-monospace, 'SF Mono', 'Cascadia Mono', 'Cascadia Code', Menlo, Consolas, 'DejaVu Sans Mono', monospace"
const ethColor = theme.wordmarkEth

const ncols = Math.max(...LINES.map((l) => l.length))
const decorCols = Math.max(...LEFT_DECOR.map((l) => l.length))
const width = Math.round(leftPad + (decorCols * 2 + ncols) * cellW + rightPad)
const height = Math.round(topBaseline + (LINES.length - 1) * lineHeight + bottomMargin)

const xmlEscape = (ch: string): string =>
  ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch

const tspan = (x: number, glyph: string, color: string | null): string => {
  const colorAttr = color ? `fill="${color}"` : 'class="eth"'
  return `<tspan x="${x.toFixed(2)}" textLength="${cellW}" lengthAdjust="spacingAndGlyphs" ${colorAttr}>${xmlEscape(glyph)}</tspan>`
}

const renderLine = (line: string, row: number): string => {
  const y = (topBaseline + row * lineHeight).toFixed(2)
  const agent = line.slice(SPLIT)
  const maxAgent = Math.max(1, agent.length - 1)
  const left = [...(LEFT_DECOR[row] ?? '')]
    .map((glyph, i) => tspan(leftPad + i * cellW, glyph, ethColor))
    .join('')
  const spans = [...line]
    .map((glyph, i) => {
      const x = leftPad + (decorCols + i) * cellW
      if (i < SPLIT) return tspan(x, glyph, null)
      return tspan(x, glyph, gradientColor((i - SPLIT) / maxAgent))
    })
    .join('')
  const right = [...(RIGHT_DECOR[row] ?? '')]
    .map((glyph, i) => tspan(leftPad + (decorCols + ncols + i) * cellW, glyph, ethColor))
    .join('')
  return `  <text y="${y}">${left}${spans}${right}</text>`
}

const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"`,
  `     font-family="${fontFamily}"`,
  `     font-size="${fontSize}" font-weight="400" xml:space="preserve">`,
  '  <style>',
  `    .eth { fill: ${ethColor}; }`,
  '  </style>',
  ...LINES.map((line, row) => renderLine(line, row)),
  '</svg>',
  '',
].join('\n')

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '..', 'preview', 'image.svg')
writeFileSync(out, svg)
console.log(`wrote ${out} (${width}x${height}, ${ncols} cols)`)
