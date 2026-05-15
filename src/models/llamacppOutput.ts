import type { LlamaCppInstallPlan, LlamaCppInstallResult } from './llamacpp.js'

type RunInstallResult = { ok: true } | { ok: false; message: string; detail?: string }

export function summarizeInstallOutput(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map(cleanInstallLine)
    .filter(Boolean)
    .filter(line => !/^[\-\\|/_.=\s]+$/.test(line))
    .filter(line => !/^\d+(\.\d+)?\s*(B|KB|MB|GB)\s*\/\s*\d+/i.test(line))
  const unique = [...new Set(lines)]
  return unique.slice(-6).join('\n') || undefined
}

export function humanInstallError(plan: LlamaCppInstallPlan, code: number | null): string {
  if (plan.command === 'winget') return 'Windows could not install the local runner automatically.'
  if (plan.command === 'brew') return 'Homebrew could not install the local runner automatically.'
  if (plan.command === 'nix') return 'Nix could not install the local runner automatically.'
  if (plan.command === 'port') return 'MacPorts could not install the local runner automatically.'
  if (plan.command === 'git') return 'ethagent could not download the local runner source.'
  if (plan.command === 'cmake') return 'ethagent could not build the local runner.'
  return code === null
    ? `${plan.label} did not complete.`
    : `${plan.label} failed with exit code ${code}.`
}

export function installFailureDetail(code: number | null, output: string): string | undefined {
  const details = [
    code === null ? undefined : `exit code ${code}`,
    summarizeInstallOutput(output),
  ].filter((item): item is string => Boolean(item))
  return details.join('\n') || undefined
}

function cleanInstallLine(line: string): string {
  return line
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function installerProgressLabel(plan: LlamaCppInstallPlan): string {
  if (plan.command === 'winget') return 'installing with Windows package manager...'
  if (plan.command === 'brew') return 'installing with Homebrew...'
  if (plan.command === 'nix') return 'installing with Nix...'
  if (plan.command === 'port') return 'installing with MacPorts...'
  return `installing with ${plan.label}...`
}

export function formatInstallFailure(label: string, result: RunInstallResult): string {
  if (result.ok) return label
  return [label, result.message, result.detail].filter(Boolean).join(': ')
}

export function buildFailure(result: RunInstallResult): LlamaCppInstallResult {
  return {
    ok: false,
    code: 'build-failed',
    message: 'ethagent could not build the local runner.',
    detail: result.ok ? undefined : [result.message, result.detail].filter(Boolean).join('\n'),
    recovery: ['runner-path', 'retry-install', 'back'],
  }
}
