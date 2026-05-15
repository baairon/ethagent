import type { EthagentConfig, ProviderId } from '../storage/config.js'
import { getConfigPath, localProviderBaseUrlFor } from '../storage/config.js'
import { detectLlamaCpp } from '../models/llamacpp.js'
import { detectSpec } from '../models/runtimeDetection.js'
import { getIdentityStatus } from '../storage/identity.js'
import { getLocalHfCacheDir } from '../models/huggingface.js'
import { formatModelDisplayName } from '../models/modelDisplay.js'
import { providerDisplayName } from '../models/modelPickerOptions.js'
import type { ModelCatalogResult } from '../models/catalog.js'
import type { SlashContext } from './commands.js'

export function renderStatus(ctx: SlashContext): string {
  const elapsedMs = Date.now() - ctx.startedAt
  const minutes = Math.floor(elapsedMs / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  const elapsed = minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}s`
  const displayModel = formatModelDisplayName(ctx.config.provider, ctx.config.model, { maxLength: 72 })
  return [
    `provider   ${providerDisplayName(ctx.config.provider)}`,
    `model      ${displayModel}`,
    `cwd        ${ctx.cwd}`,
    `session    ${ctx.sessionId.slice(0, 8)}`,
    'state      active',
    `turns      ${ctx.turns}`,
    `tokens     ~${ctx.approxTokens}`,
    `context    ${ctx.contextUsage.percent}% (~${ctx.contextUsage.usedTokens}/${ctx.contextUsage.windowTokens}, ${ctx.contextUsage.source})`,
    `elapsed    ${elapsed}`,
  ].join('\n')
}

export function renderContext(ctx: SlashContext): string {
  const usage = ctx.contextUsage
  const free = Math.max(0, usage.windowTokens - usage.usedTokens)
  const action =
    usage.percent >= 90
      ? 'Context is near the model limit. New requests will ask you to summarize into a new conversation, switch models, ignore and send, or cancel.'
      : usage.percent >= 75
        ? 'Context is getting full. Consider /compact before a new task boundary.'
        : 'Context has comfortable room.'
  return [
    'context usage:',
    `  model      ${providerDisplayName(ctx.config.provider)} Â· ${formatModelDisplayName(ctx.config.provider, ctx.config.model, { maxLength: 72 })}`,
    `  used       ~${usage.usedTokens} / ${usage.windowTokens} tokens (${usage.percent}%)`,
    `  free       ~${free} tokens`,
    `  estimate   ${usage.confidence} (${usage.source})`,
    '  session    active',
    '',
    action,
  ].join('\n')
}

export function renderDoctor(
  spec: Awaited<ReturnType<typeof detectSpec>>,
  keys: ReadonlyArray<readonly [ProviderId, boolean]>,
  identity: Awaited<ReturnType<typeof getIdentityStatus>>,
  ctx: SlashContext,
  llamaCpp: Awaited<ReturnType<typeof detectLlamaCpp>>,
  hfModelCount: number,
): string {
  const lines: string[] = ['diagnostics:']
  lines.push(`  platform   ${spec.platform}/${spec.arch}${spec.isAppleSilicon ? ' (apple silicon)' : ''}`)
  lines.push(`  ram        ${formatGB(spec.effectiveRamBytes)}${spec.gpuVramBytes ? ` Â· vram ${formatGB(spec.gpuVramBytes)}` : ''}`)
  lines.push(`  local run  ${llamaCpp.binaryPresent ? 'installed' : 'not installed'} Â· server ${llamaCpp.serverUp ? 'up' : 'down'}`)
  lines.push(`  hf models  ${hfModelCount} downloaded`)
  lines.push('')
  lines.push('config:')
  lines.push(`  provider   ${providerDisplayName(ctx.config.provider)}`)
  lines.push(`  model      ${formatModelDisplayName(ctx.config.provider, ctx.config.model, { maxLength: 72 })}`)
  if (ctx.config.baseUrl) lines.push(`  baseUrl    ${ctx.config.baseUrl}`)
  if (ctx.config.provider === 'llamacpp') lines.push(`  hf cache   ${getLocalHfCacheDir()}`)
  lines.push(`  path       ${getConfigPath()}`)
  lines.push('')
  lines.push('keys:')
  for (const [provider, present] of keys) {
    lines.push(`  ${providerDisplayName(provider).padEnd(9)}  ${present ? 'set' : 'not set'}`)
  }
  lines.push('')
  lines.push('identity:')
  if (identity) {
    lines.push(`  address    ${identity.address}`)
    lines.push(`  backend    ${identity.backend}`)
    if (identity.source) lines.push(`  source     ${identity.source}`)
    if (identity.agentId) lines.push(`  token      #${identity.agentId}`)
  } else {
    lines.push('  address    not set')
  }
  return lines.join('\n')
}

export function renderModelCatalog(catalog: ModelCatalogResult, currentModel: string): string {
  const title = catalog.status === 'fallback'
    ? `${providerDisplayName(catalog.provider)} models (fallback${catalog.error ? `: ${catalog.error}` : ''}):`
    : `${providerDisplayName(catalog.provider)} models:`
  const lines = catalog.entries.map(entry => {
    const marker = entry.id === currentModel ? '*' : ' '
    const suffix = entry.source === 'fallback' ? '  fallback' : ''
    return `${marker} ${formatModelDisplayName(catalog.provider, entry.id, { maxLength: 72 })}${suffix}`
  })
  return [title, ...lines].join('\n')
}

export function baseUrlForModelSwitch(config: EthagentConfig): string | undefined {
  if (config.provider === 'llamacpp') return localProviderBaseUrlFor('llamacpp', config.baseUrl)
  if (config.provider === 'openai') return config.baseUrl
  return undefined
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'â€”'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)}GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)}MB`
}

function formatGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 10) return `${Math.round(gb)}GB`
  return `${gb.toFixed(1)}GB`
}
