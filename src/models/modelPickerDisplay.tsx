import React from 'react'
import { Spinner } from '../ui/Spinner.js'
import { theme } from '../ui/theme.js'
import { contextWindowInfo } from '../runtime/compaction.js'
import type { ProviderId } from '../storage/config.js'
import type { HfCredibility, HfRisk } from './huggingface.js'
import type { GgufMachineFit } from './modelRecommendation.js'
import type { CloudProviderId, ModelPickerContextFit } from './modelPickerOptions.js'

export function contextFitSubtitle(contextFit: ModelPickerContextFit): string {
  const threshold = contextFit.thresholdPercent ?? 90
  return `pending prompt needs ~${formatTokens(contextFit.usedTokens)} tokens; choose a model under ${threshold}% or use /compact.`
}

export function contextFitLabel(
  provider: ProviderId,
  model: string,
  baseLabel: string,
  contextFit?: ModelPickerContextFit | null,
): string {
  if (!contextFit) return baseLabel
  const info = contextWindowInfo(provider, model)
  const percent = info.tokens > 0 ? Math.round((contextFit.usedTokens / info.tokens) * 100) : 0
  return `${baseLabel}  ${formatContextWindow(info.tokens)} ctx ${percent}%`
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return Number.isInteger(millions) ? `${millions}m` : `${millions.toFixed(1)}m`
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'size unknown'
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

export function modelMetadataSubtext(size: string, indicators: string[]): string | undefined {
  return [size, ...indicators].filter(Boolean).join(' · ') || undefined
}

export function riskColor(risk: string): string {
  if (risk === 'high') return theme.accentError
  if (risk === 'medium') return theme.dim
  return theme.accentPeriwinkle
}

export function fitColor(fit: GgufMachineFit): string {
  if (fit === 'too-large') return theme.accentError
  if (fit === 'tight') return theme.accentPeriwinkle
  return theme.dim
}

export function fitLabel(fit: GgufMachineFit, recommended: boolean): string {
  if (recommended && fit !== 'too-large') return 'Recommended for this machine'
  if (recommended) return 'Best match found; may be too large'
  return fileFitHint(fit)
}

function fileFitHint(fit: GgufMachineFit): string {
  switch (fit) {
    case 'fits': return 'Fits this machine'
    case 'tight': return 'May be slow or tight on memory'
    case 'too-large': return 'Likely too large for this machine'
    case 'unknown': return 'machine fit unknown'
  }
}

export function formatSignals(downloads: number | undefined, likes: number | undefined): string {
  const d = downloads == null ? 'downloads unknown' : `${downloads} downloads`
  const l = likes == null ? 'likes unknown' : `${likes} likes`
  return `${d}, ${l}`
}

export function friendlyFileName(filename: string): string {
  return filename.split('/').pop() ?? filename
}

export function safetyLabel(risk: HfRisk): string {
  if (risk === 'low') return 'reviewed'
  if (risk === 'medium') return 'needs review'
  return 'blocked'
}

export function credibilityLabel(credibility: HfCredibility): string {
  if (credibility === 'established') return 'established'
  if (credibility === 'normal') return 'some signals'
  return 'limited signals'
}

export function friendlyReasons(reasons: string[]): string[] {
  return reasons.map(reason => {
    if (reason.includes('compatible local model file')) return 'compatible local model file'
    if (reason.includes('selected file is not compatible')) return 'file is not compatible with local chat'
    if (reason.includes('revision is mutable')) return 'model link may point to changing files'
    if (reason.includes('license is missing')) return 'license is missing'
    if (reason.includes('limited public usage signals')) return 'source has limited public usage'
    if (reason.includes('pickle/bin')) return 'repo also contains risky model file formats'
    return reason
  })
}

export function providerKeyPlaceholder(provider: ProviderId): string {
  if (provider === 'openai') return 'sk-...'
  if (provider === 'anthropic') return 'sk-ant-...'
  if (provider === 'gemini') return 'AIza...'
  return ''
}

export function runnerPathPlaceholder(): string {
  if (process.platform === 'win32') return 'C:\\path\\to\\llama-server.exe'
  return '/path/to/llama-server'
}

export function isCloudProvider(value: string | undefined): value is CloudProviderId {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}

export const ElapsedSpinner: React.FC<{ startedAt: number; label: string }> = ({ startedAt, label }) => {
  return <Spinner label={label} startedAt={startedAt} />
}
