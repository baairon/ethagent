import React, { useEffect, useRef, useState } from 'react'
import { Text } from 'ink'
import { theme } from './theme.js'

export const SPINNER_VERBS: string[] = [
  'accomplishing',
  'actioning',
  'actualizing',
  'architecting',
  'baking',
  'beaming',
  "beboppin'",
  'befuddling',
  'billowing',
  'blanching',
  'bloviating',
  'boogieing',
  'boondoggling',
  'booping',
  'bootstrapping',
  'brewing',
  'bunning',
  'burrowing',
  'calculating',
  'canoodling',
  'caramelizing',
  'cascading',
  'catapulting',
  'cerebrating',
  'channeling',
  'choreographing',
  'churning',
  'coalescing',
  'cogitating',
  'combobulating',
  'composing',
  'computing',
  'concocting',
  'considering',
  'contemplating',
  'cooking',
  'crafting',
  'creating',
  'crunching',
  'crystallizing',
  'cultivating',
  'deciphering',
  'deliberating',
  'determining',
  'dilly-dallying',
  'discombobulating',
  'doing',
  'doodling',
  'drizzling',
  'ebbing',
  'effecting',
  'elucidating',
  'embellishing',
  'enchanting',
  'envisioning',
  'evaporating',
  'fermenting',
  'fiddle-faddling',
  'finagling',
  'flambéing',
  'flibbertigibbeting',
  'flowing',
  'flummoxing',
  'fluttering',
  'forging',
  'forming',
  'frolicking',
  'frosting',
  'gallivanting',
  'galloping',
  'garnishing',
  'generating',
  'gesticulating',
  'germinating',
  'grooving',
  'gusting',
  'harmonizing',
  'hashing',
  'hatching',
  'herding',
  'honking',
  'hullaballooing',
  'hyperspacing',
  'ideating',
  'imagining',
  'improvising',
  'incubating',
  'inferring',
  'infusing',
  'ionizing',
  'jitterbugging',
  'julienning',
  'kneading',
  'leavening',
  'levitating',
  'lollygagging',
  'manifesting',
  'marinating',
  'meandering',
  'metamorphosing',
  'misting',
  'moonwalking',
  'moseying',
  'mulling',
  'mustering',
  'musing',
  'nebulizing',
  'nesting',
  'noodling',
  'nucleating',
  'orbiting',
  'orchestrating',
  'osmosing',
  'perambulating',
  'percolating',
  'perusing',
  'philosophising',
  'photosynthesizing',
  'pollinating',
  'pondering',
  'pontificating',
  'pouncing',
  'precipitating',
  'prestidigitating',
  'processing',
  'proofing',
  'propagating',
  'puttering',
  'puzzling',
  'quantumizing',
  'razzle-dazzling',
  'razzmatazzing',
  'recombobulating',
  'reticulating',
  'roosting',
  'ruminating',
  'sautéing',
  'scampering',
  'schlepping',
  'scurrying',
  'seasoning',
  'shenaniganing',
  'shimmying',
  'simmering',
  'skedaddling',
  'sketching',
  'slithering',
  'smooshing',
  'sock-hopping',
  'spelunking',
  'spinning',
  'sprouting',
  'stewing',
  'sublimating',
  'swirling',
  'swooping',
  'symbioting',
  'synthesizing',
  'tempering',
  'thinking',
  'thundering',
  'tinkering',
  'tomfoolering',
  'topsy-turvying',
  'transfiguring',
  'transmuting',
  'twisting',
  'undulating',
  'unfurling',
  'unravelling',
  'vibing',
  'waddling',
  'wandering',
  'warping',
  'whatchamacalliting',
  'whirlpooling',
  'whirring',
  'whisking',
  'wibbling',
  'working',
  'wrangling',
  'zesting',
  'zigzagging',
]

export function pickVerb(): string {
  const idx = Math.floor(Math.random() * SPINNER_VERBS.length)
  return SPINNER_VERBS[idx] ?? 'thinking'
}

type SpinnerProps = {
  active?: boolean
  hint?: string
  label?: string
  verb?: string
  color?: string
  startedAt?: number
  showElapsed?: boolean
}

const FRAMES = ['.', 'o', 'O', 'o']

export const Spinner: React.FC<SpinnerProps> = ({
  active = true,
  hint: rawHint,
  label,
  verb,
  color = theme.accentSecondary,
  startedAt,
  showElapsed = true,
}) => {
  const stickyVerbRef = useRef<string | null>(null)
  const internalStartedAtRef = useRef<number>(Date.now())
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) {
      stickyVerbRef.current = null
      internalStartedAtRef.current = Date.now()
      return
    }

    if (label === undefined && stickyVerbRef.current === null) {
      stickyVerbRef.current = verb ?? pickVerb()
    }
  }, [active, verb, label])

  useEffect(() => {
    if (!active) return
    internalStartedAtRef.current = startedAt ?? Date.now()
  }, [active, startedAt, label, verb])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % FRAMES.length)
    }, 120)
    return () => clearInterval(timer)
  }, [active])

  if (!active) return null

  const autoLabel = stickyVerbRef.current ?? verb ?? 'thinking'
  const text = label ?? `${autoLabel}…`
  const glyph = FRAMES[frame] ?? 'o'
  const elapsed = showElapsed ? formatElapsedSeconds(Date.now() - (startedAt ?? internalStartedAtRef.current)) : null
  const renderedHint = [rawHint, elapsed].filter(Boolean).join(' · ')
  const hint = renderedHint

  return (
    <Text>
      <Text color={color}>{glyph}</Text>
      <Text color={theme.dim}> {text}</Text>
      {hint ? <Text color={theme.dim}> · {hint}</Text> : null}
    </Text>
  )
}

function formatElapsedSeconds(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`
}
