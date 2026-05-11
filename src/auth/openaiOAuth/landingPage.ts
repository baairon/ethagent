import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { WALLET_CSS } from '../../identity/wallet/page/styles/index.js'
import { glyphs } from '../../identity/wallet/page/html.js'
import { escapeHtml } from './shared.js'

export type LandingTone = 'success' | 'error' | 'cancelled'

const GRAINIENT_SOURCE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'identity',
  'wallet',
  'page',
  'grainient.ts',
)

const COMPILED_GRAINIENT = compileGrainientModule()

const GRAINIENT_OPTIONS = {
  color1: '#000422',
  color2: '#d8dcfa',
  color3: '#000422',
  timeSpeed: 0.25,
  colorBalance: 0,
  warpStrength: 1,
  warpFrequency: 5,
  warpSpeed: 2,
  warpAmplitude: 10,
  blendAngle: 0,
  blendSoftness: 0.05,
  rotationAmount: 500,
  noiseScale: 2,
  grainAmount: 0.1,
  grainScale: 2,
  grainAnimated: false,
  contrast: 1.5,
  gamma: 1,
  saturation: 1,
  centerX: 0,
  centerY: 0,
  zoom: 0.9,
}

const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'

const LANDING_EXTRA_CSS = `
main[data-flow="signin"] .body > .status { margin-top: 9px; }
main[data-tone="error"] .status .marker {
  color: var(--c-danger);
  border-color: color-mix(in srgb, var(--c-danger) 45%, transparent);
}
`

function markerHtml(tone: LandingTone): string {
  if (tone === 'success') return CHECK_SVG
  if (tone === 'error') return '<span aria-hidden="true">!</span>'
  return '<span aria-hidden="true">–</span>'
}

export function renderOAuthLandingPage(args: {
  tone: LandingTone
  pageTitle: string
  headline: string
  message: string
}): string {
  const title = escapeHtml(args.pageTitle)
  const headline = escapeHtml(args.headline)
  const message = escapeHtml(args.message)
  const splash = escapeHtml(glyphs.eyes)
  const optionsJson = JSON.stringify(GRAINIENT_OPTIONS).replaceAll('<', '\\u003c')
  const safeScript = COMPILED_GRAINIENT.replaceAll('</', '<\\/')
  const marker = markerHtml(args.tone)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${WALLET_CSS}
${LANDING_EXTRA_CSS}</style>
</head>
<body>
  <canvas id="grainient" class="grainient-canvas" aria-hidden="true"></canvas>
  <main id="card" data-flow="signin" data-tone="${args.tone}">
    <div class="chrome">
      <span class="chrome-spacer"></span>
      <span class="chrome-title">ethagent</span>
      <span class="chrome-actions"></span>
    </div>
    <div class="body">
      <div class="splash-wrap"><pre class="splash">${splash}</pre></div>
      <h2 class="flow-title">${headline}</h2>
      <div class="status">
        <p class="status-line">
          <span class="marker">${marker}</span>
          <span>${message}</span>
        </p>
        <p class="status-hint">You may close this tab now.</p>
      </div>
    </div>
  </main>
  <script>
${safeScript}
;(function () {
  var canvas = document.getElementById('grainient');
  if (canvas) startGrainient(canvas, ${optionsJson});
})();
  </script>
</body>
</html>`
}

function compileGrainientModule(): string {
  const source = readFileSync(GRAINIENT_SOURCE_FILE, 'utf8')
  const stripped = source
    .split(/\r?\n/)
    .map(line => line.replace(/^export\s+(?=(function|const|let|interface|type|class)\b)/, ''))
    .join('\n')
  return transformSync(stripped, { loader: 'ts', target: 'es2020' }).code
}
