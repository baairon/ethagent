import path from 'node:path'
import type { PermissionDecision, PermissionRequest, SessionPermissionRule } from './contracts.js'

export function buildPermissionRule(
  decision: PermissionDecision,
  request: PermissionRequest,
): SessionPermissionRule | undefined {
  switch (decision) {
    case 'allow-kind-project':
      if (request.kind === 'read' || request.kind === 'edit' || request.kind === 'cd') return { kind: request.kind, scope: 'kind' }
      return undefined
    case 'allow-path-project':
      if (request.kind === 'read' || request.kind === 'edit' || request.kind === 'cd') {
        return { kind: request.kind, scope: 'path', path: request.path }
      }
      return undefined
    case 'allow-directory-project':
      if (request.kind === 'read' || request.kind === 'edit' || request.kind === 'cd') {
        return { kind: request.kind, scope: 'directory', path: request.directoryPath }
      }
      return undefined
    case 'allow-command-project':
      if (request.kind === 'bash' && request.canPersistExact) {
        return { kind: 'bash', scope: 'command', command: request.command, cwd: request.cwd }
      }
      return undefined
    case 'allow-command-prefix-project':
      if (request.kind === 'bash' && request.canPersistPrefix && request.commandPrefix) {
        return { kind: 'bash', scope: 'prefix', commandPrefix: request.commandPrefix, cwd: request.cwd }
      }
      return undefined
    default:
      return undefined
  }
}

export function matchPermissionRule(
  rules: SessionPermissionRule[],
  request: PermissionRequest,
): SessionPermissionRule | undefined {
  return rules.find(rule => matchesPermissionRule(rule, request))
}

export function shouldPersistPermissionDecision(decision: PermissionDecision): boolean {
  return decision !== 'allow-once' && decision !== 'deny'
}

function matchesPermissionRule(rule: SessionPermissionRule, request: PermissionRequest): boolean {
  if (rule.kind !== request.kind) return false

  if (request.kind === 'read' || request.kind === 'edit' || request.kind === 'cd') {
    if (rule.scope === 'kind') return true
    if (rule.scope === 'path') return rule.path === request.path
    if (rule.scope === 'directory') {
      return request.path === rule.path || request.path.startsWith(`${rule.path}${path.sep}`)
    }
    return false
  }

  if (rule.scope === 'command') return rule.command === request.command && rule.cwd === request.cwd
  if (rule.scope === 'prefix') {
    const normalizedCommand = request.command.trim()
    return (
      rule.cwd === request.cwd &&
      (normalizedCommand === rule.commandPrefix || normalizedCommand.startsWith(`${rule.commandPrefix} `))
    )
  }
  return false
}
