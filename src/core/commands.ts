import type { EthagentConfig, ProviderId } from '../storage/config.js'
import { defaultBaseUrlFor, getConfigPath, saveConfig } from '../storage/config.js'
import { isDaemonUp, listInstalled, pullModel, type PullProgress } from '../bootstrap/ollama.js'
import { detectSpec } from '../bootstrap/runtimeDetection.js'
import { hasKey } from '../storage/secrets.js'
import { copyToClipboard } from '../utils/clipboard.js'
import { parseSegments } from '../utils/markdownSegments.js'
import { exportSessionMarkdown } from '../storage/sessionExport.js'
import type { SessionMessage } from '../storage/sessions.js'

export type SlashContext = {
  config: EthagentConfig
  turns: number
  approxTokens: number
  startedAt: number
  sessionId: string
  sessionMessages: () => SessionMessage[]
  assistantTurns: () => string[]
  onReplaceConfig: (next: EthagentConfig) => void
  onClear: () => void
  onExit: () => void
  onResumeRequest: () => void
  onCompactRequest: () => void
  onCopyPickerRequest: (turnText: string, turnLabel: string) => void
  onPullStart: (name: string) => { progressId: string; signal: AbortSignal }
  onPullProgress: (progressId: string, event: PullProgress) => void
  onPullDone: (progressId: string, model: string, error?: string) => void
}

export type SlashResult =
  | { kind: 'note'; text: string; variant?: 'info' | 'error' | 'dim' }
  | { kind: 'handled' }

type CommandSpec = {
  name: string
  aliases?: string[]
  summary: string
  run: (args: string, ctx: SlashContext) => Promise<SlashResult> | SlashResult
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
      return { kind: 'note', text: 'transcript cleared.', variant: 'dim' }
    },
  },
  {
    name: 'status',
    summary: 'provider, model, session id, turns, tokens, elapsed',
    run: (_args, ctx) => ({ kind: 'note', text: renderStatus(ctx) }),
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
    summary: 'list installed ollama models',
    run: async (_args, ctx) => {
      if (!(await isDaemonUp())) {
        return { kind: 'note', variant: 'error', text: "ollama daemon isn't running." }
      }
      const installed = await listInstalled()
      if (installed.length === 0) {
        return { kind: 'note', text: 'no models installed. pull one with: /pull <name>' }
      }
      const lines = installed.map(m => {
        const marker = m.name === ctx.config.model ? '*' : ' '
        return `${marker} ${m.name}  ${formatBytes(m.sizeBytes)}`
      })
      return { kind: 'note', text: ['installed models:', ...lines].join('\n') }
    },
  },
  {
    name: 'model',
    summary: 'switch to an installed model · /model <name>',
    run: async (args, ctx) => {
      const name = args.trim()
      if (!name) return { kind: 'note', variant: 'error', text: 'usage: /model <name>' }
      if (!(await isDaemonUp())) {
        return { kind: 'note', variant: 'error', text: "ollama daemon isn't running." }
      }
      const installed = await listInstalled()
      if (!installed.some(m => m.name === name)) {
        return {
          kind: 'note',
          variant: 'error',
          text: `'${name}' isn't installed. try /pull ${name} first.`,
        }
      }
      const next: EthagentConfig = {
        ...ctx.config,
        provider: 'ollama',
        model: name,
        baseUrl: ctx.config.baseUrl ?? defaultBaseUrlFor('ollama'),
      }
      await saveConfig(next)
      ctx.onReplaceConfig(next)
      return { kind: 'note', text: `now using ${name}.` }
    },
  },
  {
    name: 'pull',
    summary: 'download an ollama model · /pull <name>',
    run: async (args, ctx) => {
      const name = args.trim()
      if (!name) return { kind: 'note', variant: 'error', text: 'usage: /pull <name>' }
      if (!(await isDaemonUp())) {
        return { kind: 'note', variant: 'error', text: "ollama daemon isn't running." }
      }
      const { progressId, signal } = ctx.onPullStart(name)
      void runPull(name, progressId, signal, ctx)
      return { kind: 'handled' }
    },
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
    name: 'compact',
    summary: 'summarize older turns to free up context',
    run: (_args, ctx) => {
      ctx.onCompactRequest()
      return { kind: 'handled' }
    },
  },
  {
    name: 'copy',
    summary: 'copy an assistant reply to the clipboard · /copy [n]',
    run: async (args, ctx) => {
      const assistant = ctx.assistantTurns()
      if (assistant.length === 0) {
        return { kind: 'note', variant: 'error', text: 'nothing to copy yet.' }
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
        return { kind: 'note', variant: 'error', text: `only ${assistant.length} assistant reply on record.` }
      }
      const text = assistant[index] ?? ''
      const label = offset === 1 ? 'latest reply' : `reply #${offset} back`
      const segments = parseSegments(text)
      if (segments.length <= 1) {
        const result = await copyToClipboard(text)
        if (!result.ok) {
          return { kind: 'note', variant: 'error', text: `copy failed: ${result.error}` }
        }
        return { kind: 'note', text: `copied ${text.length} chars via ${result.method}.`, variant: 'dim' }
      }
      ctx.onCopyPickerRequest(text, label)
      return { kind: 'handled' }
    },
  },
  {
    name: 'export',
    summary: 'write the transcript to a markdown file',
    run: async (_args, ctx) => {
      const messages = ctx.sessionMessages()
      if (messages.length === 0) {
        return { kind: 'note', variant: 'error', text: 'nothing to export yet.' }
      }
      try {
        const file = await exportSessionMarkdown(ctx.sessionId, messages, {
          model: ctx.config.model,
          provider: ctx.config.provider,
        })
        return { kind: 'note', text: `exported to ${file}` }
      } catch (err: unknown) {
        return { kind: 'note', variant: 'error', text: `export failed: ${(err as Error).message}` }
      }
    },
  },
  {
    name: 'doctor',
    summary: 'spec, config, daemon status, key presence',
    run: async (_args, ctx) => {
      const [spec, daemonUp, keys] = await Promise.all([
        detectSpec(),
        isDaemonUp(),
        Promise.all(
          (['openai', 'anthropic', 'gemini'] as ProviderId[]).map(async p => [p, await hasKey(p)] as const),
        ),
      ])
      return { kind: 'note', text: renderDoctor(spec, daemonUp, keys, ctx) }
    },
  },
]

async function runPull(
  name: string,
  progressId: string,
  signal: AbortSignal,
  ctx: SlashContext,
): Promise<void> {
  try {
    let last = 0
    for await (const event of pullModel(name, undefined, signal)) {
      if (signal.aborted) {
        ctx.onPullDone(progressId, name, 'cancelled')
        return
      }
      const now = Date.now()
      const final = event.status === 'success' || !event.total
      if (final || now - last > 100) {
        last = now
        ctx.onPullProgress(progressId, event)
      }
    }
    if (signal.aborted) {
      ctx.onPullDone(progressId, name, 'cancelled')
      return
    }
    ctx.onPullDone(progressId, name)
  } catch (err: unknown) {
    if (signal.aborted) {
      ctx.onPullDone(progressId, name, 'cancelled')
      return
    }
    ctx.onPullDone(progressId, name, (err as Error).message)
  }
}

function renderHelp(): string {
  const maxName = Math.max(...COMMANDS.map(c => commandLabel(c).length))
  const lines = COMMANDS.map(c => {
    const label = commandLabel(c)
    return `  ${label.padEnd(maxName)}   ${c.summary}`
  })
  return [
    'slash commands:',
    ...lines,
    '',
    'shortcuts: esc cancels · ctrl+c twice exits · alt+p swap model · shift+tab mode.',
  ].join('\n')
}

function commandLabel(cmd: CommandSpec): string {
  if (!cmd.aliases || cmd.aliases.length === 0) return `/${cmd.name}`
  return `/${cmd.name} (${cmd.aliases.map(a => `/${a}`).join(', ')})`
}

function renderStatus(ctx: SlashContext): string {
  const elapsedMs = Date.now() - ctx.startedAt
  const minutes = Math.floor(elapsedMs / 60000)
  const seconds = Math.floor((elapsedMs % 60000) / 1000)
  const elapsed = minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}s`
  return [
    `provider   ${ctx.config.provider}`,
    `model      ${ctx.config.model}`,
    `session    ${ctx.sessionId.slice(0, 8)}`,
    `turns      ${ctx.turns}`,
    `tokens     ~${ctx.approxTokens}`,
    `elapsed    ${elapsed}`,
  ].join('\n')
}

function renderDoctor(
  spec: Awaited<ReturnType<typeof detectSpec>>,
  daemonUp: boolean,
  keys: ReadonlyArray<readonly [ProviderId, boolean]>,
  ctx: SlashContext,
): string {
  const lines: string[] = ['diagnostics:']
  lines.push(`  platform   ${spec.platform}/${spec.arch}${spec.isAppleSilicon ? ' (apple silicon)' : ''}`)
  lines.push(`  ram        ${formatGB(spec.effectiveRamBytes)}${spec.gpuVramBytes ? ` · vram ${formatGB(spec.gpuVramBytes)}` : ''}`)
  lines.push(`  ollama     ${spec.hasOllama ? spec.ollamaVersion ?? 'installed' : 'not installed'} · daemon ${daemonUp ? 'up' : 'down'}`)
  lines.push(`  models     ${spec.installedModels.length} installed`)
  lines.push('')
  lines.push('config:')
  lines.push(`  provider   ${ctx.config.provider}`)
  lines.push(`  model      ${ctx.config.model}`)
  if (ctx.config.baseUrl) lines.push(`  baseUrl    ${ctx.config.baseUrl}`)
  lines.push(`  path       ${getConfigPath()}`)
  lines.push('')
  lines.push('keys:')
  for (const [provider, present] of keys) {
    lines.push(`  ${provider.padEnd(9)}  ${present ? 'set' : 'not set'}`)
  }
  return lines.join('\n')
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
    return { kind: 'note', variant: 'error', text: `unknown command: /${parsed.name}. try /help` }
  }
  return cmd.run(parsed.args, ctx)
}

export function getSlashSuggestions(): Array<{ name: string; summary: string }> {
  return COMMANDS.map(c => ({ name: c.name, summary: c.summary }))
}
