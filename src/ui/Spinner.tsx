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

export function spinnerText(value: string): string {
  const text = restoreSpinnerTerms(value.toLowerCase())
  return text.replace(/^(\s*)([a-z])/, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)
}

export function spinnerHintText(value: string): string {
  return restoreSpinnerTerms(value.toLowerCase())
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
  color = theme.accentPeriwinkle,
  startedAt,
  showElapsed = true,
}) => {
  const stickyVerbRef = useRef<string | null>(null)
  const internalStartedAtRef = useRef<number>(Date.now())
  const [frame, setFrame] = useState(0)
  const [shimmerPos, setShimmerPos] = useState(0)

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

  const autoLabel = stickyVerbRef.current ?? verb ?? 'thinking'
  const text = spinnerText(label ?? `${autoLabel}…`)

  useEffect(() => {
    if (!active) return
    const period = text.length + 12
    const timer = setInterval(() => {
      setShimmerPos(prev => (prev + 1) % period)
    }, 90)
    return () => clearInterval(timer)
  }, [active, text.length])

  if (!active) return null

  const glyph = FRAMES[frame] ?? 'o'
  const elapsed = showElapsed ? formatElapsedSeconds(Date.now() - (startedAt ?? internalStartedAtRef.current)) : null
  const renderedHint = [rawHint, elapsed].filter(Boolean).join(' · ')
  const hint = renderedHint ? spinnerHintText(renderedHint) : ''

  const shimmerStart = shimmerPos - 1
  const shimmerEnd = shimmerPos + 1
  const visibleStart = Math.max(0, shimmerStart)
  const visibleEnd = Math.min(text.length, shimmerEnd + 1)
  const before = text.slice(0, visibleStart)
  const shimmer = shimmerStart < text.length && shimmerEnd >= 0 ? text.slice(visibleStart, visibleEnd) : ''
  const after = text.slice(visibleEnd)

  return (
    <Text>
      <Text color={color}>{glyph}</Text>
      <Text> </Text>
      {before ? <Text color={theme.accentPeriwinkle}>{before}</Text> : null}
      {shimmer ? <Text color={theme.accentWhite} bold>{shimmer}</Text> : null}
      {after ? <Text color={theme.accentPeriwinkle}>{after}</Text> : null}
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

function restoreSpinnerTerms(value: string): string {
  return value
    .replace(/\bapi\b/g, 'API')
    .replace(/\bens\b/g, 'ENS')
    .replace(/\berc-8004\b/g, 'ERC-8004')
    .replace(/\bgguf\b/g, 'GGUF')
    .replace(/\bhugging face\b/g, 'Hugging Face')
    .replace(/\bipfs\b/g, 'IPFS')
    .replace(/\bjson\b/g, 'JSON')
    .replace(/\bjwt\b/g, 'JWT')
    .replace(/\bmemory\.md\b/g, 'MEMORY.md')
    .replace(/\bopenai\b/g, 'OpenAI')
    .replace(/\banthropic\b/g, 'Anthropic')
    .replace(/\bgemini\b/g, 'Gemini')
    .replace(/\bos\b/g, 'OS')
    .replace(/\brpc\b/g, 'RPC')
    .replace(/\bsoul\.md\b/g, 'SOUL.md')
    .replace(/\buri\b/g, 'URI')
    .replace(/\burl\b/g, 'URL')
    .replace(/\bbase\b/g, 'Base')
    .replace(/\bethereum mainnet\b/g, 'Ethereum Mainnet')
    .replace(/\bethereum\b/g, 'Ethereum')
    .replace(/\bsepolia\b/g, 'Sepolia')
    .replace(/\bbase sepolia\b/g, 'Base Sepolia')
}
