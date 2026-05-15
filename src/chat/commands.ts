import type { EthagentConfig, ProviderId } from '../storage/config.js'
import { getConfigPath, localProviderBaseUrlFor, saveConfig } from '../storage/config.js'
import { detectLlamaCpp } from '../models/llamacpp.js'
import { detectSpec } from '../models/runtimeDetection.js'
import { hasKey } from '../storage/secrets.js'
import { getIdentityStatus } from '../storage/identity.js'
import { discoverProviderModels, type ModelCatalogResult } from '../models/catalog.js'
import { getLocalHfCacheDir, loadLocalHfModels } from '../models/huggingface.js'
import { copyToClipboard } from '../utils/clipboard.js'
import { parseSegments } from '../utils/markdownSegments.js'
import { exportSessionMarkdown } from '../storage/sessionExport.js'
import { rewindWorkspaceEdits } from '../storage/rewind.js'
import type { SessionMessage } from '../storage/sessions.js'
import path from 'node:path'
import { setCwd } from '../runtime/cwd.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import type { ContextUsage } from '../runtime/compaction.js'
import { formatModelDisplayName } from '../models/modelDisplay.js'
import { providerDisplayName } from '../models/modelPickerOptions.js'
import type { McpManager } from '../mcp/manager.js'
import { runHuggingFace, runIdentity, runMcp } from './slashCommandHandlers.js'
import { renderStatus } from './slashCommandViews.js'

export type IdentityRequestAction =
  | 'manage'
  | 'create'
  | 'load'

export type SlashContext = {
  config: EthagentConfig
  turns: number
  approxTokens: number
  contextUsage: ContextUsage
  startedAt: number
  sessionId: string
  cwd: string
  mode: SessionMode
  sessionMessages: () => SessionMessage[]
  assistantTurns: () => string[]
  onReplaceConfig: (next: EthagentConfig) => void
  onChangeCwd: (next: string) => void
  onClear: () => void
  onExit: () => void
  onResumeRequest: () => void
  onModelPickerRequest: () => void
  onRewindRequest: () => void
  onPermissionsRequest: () => void
  onCompactRequest: () => void
  onIdentityRequest: (action?: IdentityRequestAction) => void
  onCopyPickerRequest: (turnText: string, turnLabel: string) => void
  mcp?: McpManager
}

export type SlashResult =
  | { kind: 'note'; text: string; variant?: 'info' | 'error' | 'dim' }
  | { kind: 'submit'; text: string }
  | { kind: 'handled' }

type CommandSpec = {
  name: string
  aliases?: string[]
  summary: string
  hidden?: boolean
  requiresArgs?: boolean
  blockedInPlan?: boolean
  enterBehavior?: 'execute' | 'fill'
  run: (args: string, ctx: SlashContext) => Promise<SlashResult> | SlashResult
}

export type SlashSuggestion = {
  name: string
  summary: string
  completion: string
  executeOnEnter: boolean
}

export function parseSlash(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const body = trimmed.slice(1)
  const spaceIdx = body.search(/\s/)
  if (spaceIdx === -1) return { name: body.toLowerCase(), args: '' }
  return {
    name: body.slice(0, spaceIdx).toLowerCase(),
    args: body.slice(spaceIdx + 1).trim(),
  }
}

const COMMANDS: CommandSpec[] = [
  {
    name: 'help',
    summary: 'show this list',
    run: () => ({ kind: 'note', text: renderHelp() }),
  },
  {
    name: 'exit',
    aliases: ['quit'],
    summary: 'exit the agent',
    run: (_args, ctx) => {
      ctx.onExit()
      return { kind: 'handled' }
    },
  },
  {
    name: 'new',
    aliases: ['clear'],
    summary: 'clear the transcript and start a new session',
    run: (_args, ctx) => {
      ctx.onClear()
      return { kind: 'handled' }
    },
  },
  {
    name: 'status',
    summary: 'provider, model, session id, turns, context, elapsed',
    run: (_args, ctx) => ({ kind: 'note', text: renderStatus(ctx) }),
  },
  {
    name: 'context',
    summary: 'show model context usage and compaction options',
    run: (_args, ctx) => ({ kind: 'note', text: renderContext(ctx) }),
  },
  {
    name: 'cd',
    requiresArgs: true,
    enterBehavior: 'fill',
    summary: 'change working directory · /cd <path>',
    run: async (args, ctx) => {
      const target = args.trim()
      if (!target) return { kind: 'note', variant: 'error', text: 'usage: /cd <path>' }
      try {
        const next = setCwd(target, ctx.cwd)
        ctx.onChangeCwd(next)
        return { kind: 'note', text: `Cwd: ${next}`, variant: 'dim' }
      } catch (err: unknown) {
        return { kind: 'note', variant: 'error', text: `Cd failed: ${(err as Error).message}` }
      }
    },
  },
  {
    name: 'config',
    summary: 'show resolved config',
    run: (_args, ctx) => ({
      kind: 'note',
      text: `${JSON.stringify(ctx.config, null, 2)}\npath: ${getConfigPath()}`,
    }),
  },
  {
    name: 'models',
    summary: 'list models for the current provider',
    run: async (_args, ctx) => {
      if (ctx.config.provider === 'llamacpp') {
        const installed = await loadLocalHfModels()
        if (installed.length === 0) {
          return {
            kind: 'note',
            text: 'No local model files downloaded. Open Alt+P and choose "Add Local Model File".',
          }
        }
        const lines = installed.map(m => {
          const marker = m.id === ctx.config.model ? '*' : ' '
          const q = m.quantization ? ` ${m.quantization}` : ''
          const displayName = formatModelDisplayName('llamacpp', m.id, { displayName: m.displayName, maxLength: 64 })
          return `${marker} ${displayName}${q}  ${formatBytes(m.sizeBytes)}  ${m.risk}`
        })
        return { kind: 'note', text: ['installed Hugging Face models:', ...lines].join('\n') }
      }

      const catalog = await discoverProviderModels(ctx.config)
      return {
        kind: 'note',
        text: renderModelCatalog(catalog, ctx.config.model),
        variant: catalog.status === 'fallback' ? 'dim' : 'info',
      }
    },
  },
  {
    name: 'model',
    enterBehavior: 'fill',
    summary: 'open picker or switch model · /model [name]',
    run: async (args, ctx) => {
      const name = args.trim()
      if (!name) {
        ctx.onModelPickerRequest()
        return { kind: 'handled' }
      }
      if (ctx.config.provider === 'llamacpp') {
        const installed = await loadLocalHfModels()
        if (!installed.some(m => m.id === name)) {
          return {
            kind: 'note',
            variant: 'error',
            text: `'${name}' is not downloaded. Open Alt+P and choose "View Full Catalog" or "Add Local Model File".`,
          }
        }
      } else {
        const catalog = await discoverProviderModels(ctx.config)
        if (catalog.status === 'ok' && !catalog.entries.some(entry => entry.id === name)) {
          return {
            kind: 'note',
            variant: 'error',
            text: `'${name}' was not found for ${providerDisplayName(ctx.config.provider)}. use /models to inspect available models.`,
          }
        }
      }
      const next: EthagentConfig = {
        ...ctx.config,
        model: name,
        baseUrl: baseUrlForModelSwitch(ctx.config),
      }
      await saveConfig(next)
      ctx.onReplaceConfig(next)
      return { kind: 'note', text: `Now using ${providerDisplayName(next.provider)} · ${formatModelDisplayName(next.provider, name, { maxLength: 64 })}.` }
    },
  },
  {
    name: 'hf',
    enterBehavior: 'fill',
    summary: 'local model files · /hf [installed|download <link>]',
    run: async (args, ctx) => runHuggingFace(args, ctx),
  },
  {
    name: 'resume',
    summary: 'reopen a prior session',
    run: (_args, ctx) => {
      ctx.onResumeRequest()
      return { kind: 'handled' }
    },
  },
  {
    name: 'rewind',
    aliases: ['checkpoint'],
    summary: 'restore recent managed file edits · /rewind [n]',
    run: async (args, ctx) => {
      const trimmed = args.trim()
      if (!trimmed) {
        ctx.onRewindRequest()
        return { kind: 'handled' }
      }
      const steps = trimmed ? Number.parseInt(trimmed, 10) : 1
      if (!Number.isFinite(steps) || steps < 1) {
        return { kind: 'note', variant: 'error', text: 'usage: /rewind [n]' }
      }
      const result = await rewindWorkspaceEdits(ctx.cwd, steps)
      if (result.reverted === 0) {
        return { kind: 'note', variant: 'error', text: 'No managed edits available to rewind in this directory.' }
      }
      const files = result.files.map(file => path.relative(ctx.cwd, file) || path.basename(file))
      return {
        kind: 'note',
        text: `Rewound ${result.reverted} edit${result.reverted === 1 ? '' : 's'}.\n${files.join('\n')}`,
        variant: 'dim',
      }
    },
  },
  {
    name: 'compact',
    summary: 'summarize older turns to free up context',
    run: (_args, ctx) => {
      ctx.onCompactRequest()
      return { kind: 'handled' }
    },
  },
  {
    name: 'permissions',
    summary: 'review or remove saved permission rules for this project',
    run: (_args, ctx) => {
      ctx.onPermissionsRequest()
      return { kind: 'handled' }
    },
  },
  {
    name: 'copy',
    summary: 'copy an assistant reply to the clipboard · /copy [n]',
    run: async (args, ctx) => {
      const assistant = ctx.assistantTurns()
      if (assistant.length === 0) {
        return { kind: 'note', variant: 'error', text: 'Nothing to copy yet.' }
      }
      let offset = 1
      const trimmed = args.trim()
      if (trimmed) {
        const parsed = Number.parseInt(trimmed, 10)
        if (!Number.isFinite(parsed) || parsed < 1) {
          return { kind: 'note', variant: 'error', text: 'usage: /copy [n]  (n counts back from the latest reply, 1 = most recent)' }
        }
        offset = parsed
      }
      const index = assistant.length - offset
      if (index < 0) {
        return { kind: 'note', variant: 'error', text: `Only ${assistant.length} assistant reply on record.` }
      }
      const text = assistant[index] ?? ''
      const label = offset === 1 ? 'Latest reply' : `Reply #${offset} back`
      const segments = parseSegments(text)
      if (segments.length <= 1) {
        const result = await copyToClipboard(text)
        if (!result.ok) {
          return { kind: 'note', variant: 'error', text: `Copy failed: ${result.error}` }
        }
        return { kind: 'note', text: `${label} copied to clipboard · ${result.chars} chars`, variant: 'dim' }
      }
      ctx.onCopyPickerRequest(text, label)
      return { kind: 'handled' }
    },
  },
  {
    name: 'export',
    blockedInPlan: true,
    summary: 'write the transcript to a markdown file',
    run: async (_args, ctx) => {
      const messages = ctx.sessionMessages()
      if (messages.length === 0) {
        return { kind: 'note', variant: 'error', text: 'Nothing to export yet.' }
      }
      try {
        const file = await exportSessionMarkdown(ctx.sessionId, messages, {
          model: ctx.config.model,
          provider: ctx.config.provider,
        })
        return { kind: 'note', text: `Exported to ${file}` }
      } catch (err: unknown) {
        return { kind: 'note', variant: 'error', text: `Export failed: ${(err as Error).message}` }
      }
    },
  },
  {
    name: 'mcp',
    enterBehavior: 'fill',
    summary: 'manage MCP servers · /mcp [status|approve|reject|reconnect|enable|disable|add-json]',
    run: async (args, ctx) => runMcp(args, ctx),
  },
  {
    name: 'identity',
    enterBehavior: 'fill',
    summary: 'Ethereum identity · /identity [status|create|load|remove]',
    run: async (args, ctx) => runIdentity(args, ctx),
  },
  {
    name: 'doctor',
    summary: 'spec, config, local runtime, key presence',
    run: async (_args, ctx) => {
      const [spec, keys, identity, llamaCpp, hfModels] = await Promise.all([
        detectSpec(),
        Promise.all(
          (['openai', 'anthropic', 'gemini'] as ProviderId[]).map(async p => [p, await hasKey(p)] as const),
        ),
        getIdentityStatus(ctx.config),
        detectLlamaCpp(),
        loadLocalHfModels(),
      ])
      return { kind: 'note', text: renderDoctor(spec, keys, identity, ctx, llamaCpp, hfModels.length) }
    },
  },
]

function renderHelp(): string {
  const visibleCommands = COMMANDS.filter(c => !c.hidden)
  const maxName = Math.max(...visibleCommands.map(c => commandLabel(c).length))
  const lines = visibleCommands.map(c => {
    const label = commandLabel(c)
    return `  ${label.padEnd(maxName)}   ${c.summary}`
  })
  return [
    'slash commands:',
    ...lines,
    '',
    'shortcuts: esc cancels · ctrl+c twice exits · alt+p model · alt+i identity · shift+tab mode.',
  ].join('\n')
}

function commandLabel(cmd: CommandSpec): string {
  if (!cmd.aliases || cmd.aliases.length === 0) return `/${cmd.name}`
  return `/${cmd.name} (${cmd.aliases.map(a => `/${a}`).join(', ')})`
}

function renderContext(ctx: SlashContext): string {
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
    `  model      ${providerDisplayName(ctx.config.provider)} · ${formatModelDisplayName(ctx.config.provider, ctx.config.model, { maxLength: 72 })}`,
    `  used       ~${usage.usedTokens} / ${usage.windowTokens} tokens (${usage.percent}%)`,
    `  free       ~${free} tokens`,
    `  estimate   ${usage.confidence} (${usage.source})`,
    '  session    active',
    '',
    action,
  ].join('\n')
}

function renderDoctor(
  spec: Awaited<ReturnType<typeof detectSpec>>,
  keys: ReadonlyArray<readonly [ProviderId, boolean]>,
  identity: Awaited<ReturnType<typeof getIdentityStatus>>,
  ctx: SlashContext,
  llamaCpp: Awaited<ReturnType<typeof detectLlamaCpp>>,
  hfModelCount: number,
): string {
  const lines: string[] = ['diagnostics:']
  lines.push(`  platform   ${spec.platform}/${spec.arch}${spec.isAppleSilicon ? ' (apple silicon)' : ''}`)
  lines.push(`  ram        ${formatGB(spec.effectiveRamBytes)}${spec.gpuVramBytes ? ` · vram ${formatGB(spec.gpuVramBytes)}` : ''}`)
  lines.push(`  local run  ${llamaCpp.binaryPresent ? 'installed' : 'not installed'} · server ${llamaCpp.serverUp ? 'up' : 'down'}`)
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

function renderModelCatalog(catalog: ModelCatalogResult, currentModel: string): string {
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

function baseUrlForModelSwitch(config: EthagentConfig): string | undefined {
  if (config.provider === 'llamacpp') return localProviderBaseUrlFor('llamacpp', config.baseUrl)
  if (config.provider === 'openai') return config.baseUrl
  return undefined
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—'
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

export async function dispatchSlash(input: string, ctx: SlashContext): Promise<SlashResult | null> {
  const parsed = parseSlash(input)
  if (!parsed) return null
  const cmd = COMMANDS.find(c => c.name === parsed.name || c.aliases?.includes(parsed.name))
  if (!cmd) {
    try {
      const promptText = await ctx.mcp?.runPromptSlash(parsed.name, parsed.args)
      if (promptText !== null && promptText !== undefined) return { kind: 'submit', text: promptText }
    } catch (err: unknown) {
      return { kind: 'note', variant: 'error', text: `MCP prompt failed: ${(err as Error).message}` }
    }
    return { kind: 'note', variant: 'error', text: `Unknown command: /${parsed.name}. Try /help` }
  }
  if (ctx.mode === 'plan' && cmd.blockedInPlan) {
    return { kind: 'note', variant: 'error', text: `/${cmd.name} is blocked in plan mode.` }
  }
  return cmd.run(parsed.args, ctx)
}

export function getSlashSuggestions(extra: SlashSuggestion[] = []): SlashSuggestion[] {
  return [...COMMANDS.filter(c => !c.hidden).map(c => ({
    name: c.name,
    summary: c.summary,
    completion: c.requiresArgs || c.enterBehavior === 'fill' ? `/${c.name} ` : `/${c.name}`,
    executeOnEnter: !c.requiresArgs && c.enterBehavior !== 'fill',
  })), ...extra]
}

function nthTokenStart(value: string, tokenIndex: number): number {
  const matches = [...value.matchAll(/\S+/g)]
  return matches[tokenIndex]?.index ?? -1
}
