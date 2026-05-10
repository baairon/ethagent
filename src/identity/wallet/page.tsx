import { injectStylesAndMarkup } from './page/markup.js'
import { startGrainient } from './page/grainient.js'
import { renderEyes } from './page/html.js'
import { bootWallet } from './page/controller.js'

injectStylesAndMarkup()

const grainCanvas = document.getElementById('grainient') as HTMLCanvasElement
if (grainCanvas) {
  startGrainient(grainCanvas, {
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
  })
}

;(document.getElementById('splash') as HTMLElement).innerHTML = renderEyes()

bootWallet()
