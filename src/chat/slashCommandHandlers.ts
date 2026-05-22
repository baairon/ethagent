import { clearIdentity, getIdentityStatus } from '../storage/identity.js'
import type { SlashContext, SlashResult } from './commands.js'

export async function runMcp(args: string, ctx: SlashContext): Promise<SlashResult> {
  if (!ctx.mcp) {
    return { kind: 'note', variant: 'error', text: 'MCP runtime is not available in this session.' }
  }

  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const sub = tokens[0]?.toLowerCase() ?? ''
  if (!sub || sub === 'status' || sub === 'list') {
    return { kind: 'note', text: ctx.mcp.renderStatus(), variant: 'info' }
  }

  try {
    if (sub === 'approve') {
      const name = tokens.slice(1).join(' ')
      if (!name) return { kind: 'note', variant: 'error', text: 'usage: /mcp approve <server>' }
      return { kind: 'note', text: await ctx.mcp.approveServer(name), variant: 'dim' }
    }
    if (sub === 'reject') {
      const name = tokens.slice(1).join(' ')
      if (!name) return { kind: 'note', variant: 'error', text: 'usage: /mcp reject <server>' }
      return { kind: 'note', text: await ctx.mcp.rejectServer(name), variant: 'dim' }
    }
    if (sub === 'reconnect') {
      const name = tokens.slice(1).join(' ') || undefined
      return { kind: 'note', text: await ctx.mcp.reconnect(name), variant: 'dim' }
    }
    if (sub === 'enable' || sub === 'disable') {
      const name = tokens.slice(1).join(' ')
      if (!name) return { kind: 'note', variant: 'error', text: `usage: /mcp ${sub} <server>` }
      return { kind: 'note', text: await ctx.mcp.setEnabled(name, sub === 'enable'), variant: 'dim' }
    }
    if (sub === 'add-json') {
      const project = tokens[1] === '--project'
      const nameIndex = project ? 2 : 1
      const name = tokens[nameIndex]
      if (!name) return { kind: 'note', variant: 'error', text: 'usage: /mcp add-json [--project] <name> <json>' }
      const jsonStart = nthTokenStart(args, nameIndex + 1)
      const json = jsonStart >= 0 ? args.slice(jsonStart).trim() : ''
      if (!json) return { kind: 'note', variant: 'error', text: 'usage: /mcp add-json [--project] <name> <json>' }
      return { kind: 'note', text: await ctx.mcp.addJson(name, json, project ? 'project' : 'user'), variant: 'dim' }
    }
  } catch (err: unknown) {
    return { kind: 'note', variant: 'error', text: `MCP failed: ${(err as Error).message}` }
  }

  return {
    kind: 'note',
    variant: 'error',
    text: 'usage: /mcp [status|approve <server>|reject <server>|reconnect [server]|enable <server>|disable <server>|add-json [--project] <name> <json>]',
  }
}

export async function runIdentity(args: string, ctx: SlashContext): Promise<SlashResult> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const sub = tokens[0]?.toLowerCase() ?? ''
  const rest = tokens.slice(1)

  if (!sub) {
    ctx.onIdentityRequest('manage')
    return { kind: 'handled' }
  }

  if (sub === 'status') {
    const status = await getIdentityStatus(ctx.config)
    if (!status) {
      return {
        kind: 'note',
        variant: 'dim',
        text: 'No Ethereum identity set. Run /identity create to make one.',
      }
    }
    const lines = [
      `address    ${status.address}`,
      `updated    ${status.createdAt}`,
      `wallet     ${status.backend}`,
    ]
    if (status.source) lines.push(`registry   ${status.source}`)
    if (status.agentId) lines.push(`agent      #${status.agentId}`)
    return { kind: 'note', text: lines.join('\n') }
  }

  if (sub === 'create') {
    ctx.onIdentityRequest('create')
    return { kind: 'handled' }
  }

  if (sub === 'load') {
    ctx.onIdentityRequest('load')
    return { kind: 'handled' }
  }

  if (sub === 'remove') {
    if (rest[0] !== 'confirm') {
      return {
        kind: 'note',
        variant: 'error',
        text: 'Remove deletes local identity metadata and any legacy stored key. Re-run with: /identity remove confirm',
      }
    }
    const status = await getIdentityStatus(ctx.config)
    if (!status) {
      return { kind: 'note', variant: 'dim', text: 'No Ethereum identity to remove.' }
    }
    const next = await clearIdentity(ctx.config)
    ctx.onReplaceConfig(next)
    return { kind: 'note', text: `Removed identity ${status.address}.`, variant: 'dim' }
  }

  return {
    kind: 'note',
    variant: 'error',
    text: 'usage: /identity [status|create|load|remove confirm]',
  }
}

function nthTokenStart(value: string, tokenIndex: number): number {
  const matches = [...value.matchAll(/\S+/g)]
  return matches[tokenIndex]?.index ?? -1
}
