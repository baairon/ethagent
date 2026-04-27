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
}

const FRAMES = ['.', 'o', 'O', 'o']

export const Spinner: React.FC<SpinnerProps> = ({
  active = true,
  hint,
  label,
  verb,
  color = theme.accentSecondary,
}) => {
  const stickyVerbRef = useRef<string | null>(null)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) {
      stickyVerbRef.current = null
      return
    }

    if (label === undefined && stickyVerbRef.current === null) {
      stickyVerbRef.current = verb ?? pickVerb()
    }
  }, [active, verb, label])

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

  return (
    <Text>
      <Text color={color}>{glyph}</Text>
      <Text color={theme.dim}> {text}</Text>
      {hint ? <Text color={theme.dim}> · {hint}</Text> : null}
    </Text>
  )
}
