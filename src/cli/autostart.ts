import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { binEntry } from './daemon.js'

export type AutostartResult = { installed: boolean; detail: string }

// A small, clearly-marked block that runs `--ensure-daemon` when a fresh shell opens,
// so the background sync comes up on its own even when no harness has launched yet.
// Markers let us upsert and remove the block idempotently without touching anything else.
const BEGIN_MARK = '# >>> ethagent autosync >>>'
const END_MARK = '# <<< ethagent autosync <<<'

/** Profile files we drop the hook into, per platform. Pure (derived from home + platform). */
export function shellProfilePaths(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    // PowerShell's $PROFILE follows the Documents known folder, which OneDrive Known Folder
    // Move commonly redirects to <OneDrive>\Documents. Target both roots so the hook lands
    // wherever PowerShell actually loads from (the plain ~\Documents is often NOT it).
    const docRoots = [path.join(home, 'Documents')]
    const oneDrive = process.env.OneDrive?.trim()
    if (oneDrive) docRoots.unshift(path.join(oneDrive, 'Documents'))
    const out: string[] = []
    for (const docs of docRoots) {
      out.push(path.join(docs, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'))
      out.push(path.join(docs, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'))
    }
    return [...new Set(out)]
  }
  return [path.join(home, '.zshrc'), path.join(home, '.bashrc')]
}

function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function pwq(s: string): string {
  return `"${s.replace(/"/g, '`"')}"`
}

function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** POSIX shell hook (zsh/bash): launch `--ensure-daemon` in the background, silently. */
export function renderShellHookBlock(node: string, entry: string): string {
  return [
    BEGIN_MARK,
    '# Starts ethagent background sync when a shell opens; delete this block to disable.',
    `[ -x ${shq(node)} ] && ( ${shq(node)} ${shq(entry)} --ensure-daemon >/dev/null 2>&1 & )`,
    END_MARK,
  ].join('\n')
}

/**
 * PowerShell profile hook: launch `--ensure-daemon` with no console window at all.
 * Uses ProcessStartInfo with UseShellExecute=$false + CreateNoWindow=$true, which (unlike
 * Start-Process) never allocates a console, so opening a terminal causes no flash.
 */
export function renderPwshHookBlock(node: string, entry: string): string {
  return [
    BEGIN_MARK,
    '# Starts ethagent background sync when a shell opens; delete this block to disable.',
    `if (Test-Path ${pwq(node)}) {`,
    '  $si = New-Object System.Diagnostics.ProcessStartInfo',
    `  $si.FileName = ${pwq(node)}`,
    `  $si.Arguments = ${psq(`"${entry}" --ensure-daemon`)}`,
    '  $si.UseShellExecute = $false',
    '  $si.CreateNoWindow = $true',
    "  $si.WindowStyle = 'Hidden'",
    '  [void][System.Diagnostics.Process]::Start($si)',
    '}',
    END_MARK,
  ].join('\n')
}

function hookBlock(node: string, entry: string): string {
  return process.platform === 'win32'
    ? renderPwshHookBlock(node, entry)
    : renderShellHookBlock(node, entry)
}

/** Strip any existing ethagent block (between the markers) from profile content. */
function stripBlock(content: string): string {
  const out: string[] = []
  let inBlock = false
  for (const line of content.split('\n')) {
    if (line.trim() === BEGIN_MARK) { inBlock = true; continue }
    if (line.trim() === END_MARK) { inBlock = false; continue }
    if (!inBlock) out.push(line)
  }
  return out.join('\n')
}

/** Write `block` into `file`, replacing any prior ethagent block. Returns false if unchanged. */
function upsertBlock(file: string, block: string): boolean {
  let existing = ''
  try { existing = fs.readFileSync(file, 'utf8') } catch { /* new file */ }
  const cleaned = stripBlock(existing).replace(/\s+$/, '')
  const next = (cleaned ? cleaned + '\n\n' : '') + block + '\n'
  if (next === existing) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next, 'utf8')
  return true
}

function shortHome(p: string): string {
  const home = os.homedir()
  return p.startsWith(home) ? '~' + p.slice(home.length) : p
}

/**
 * Add the shell-profile hook so the daemon comes up when a new terminal opens.
 * Idempotent: re-running replaces the block in place. Best-effort per profile file.
 */
export function installAutostart(): AutostartResult {
  const node = process.execPath
  const entry = binEntry()
  const block = hookBlock(node, entry)
  const targets: string[] = []
  let writable = false
  try {
    for (const file of shellProfilePaths()) {
      try {
        upsertBlock(file, block)
        writable = true
        targets.push(shortHome(file))
      } catch { /* skip an unwritable profile */ }
    }
  } catch (err) {
    return { installed: false, detail: `autostart not configured: ${(err as Error).message}` }
  }
  return writable
    ? { installed: true, detail: `shell hook in ${targets.join(', ')}` }
    : { installed: false, detail: 'no writable shell profile' }
}

/** Remove the shell-profile hook. Best-effort; safe to call when nothing is installed. */
export function uninstallAutostart(): void {
  for (const file of shellProfilePaths()) {
    try {
      const existing = fs.readFileSync(file, 'utf8')
      const cleaned = stripBlock(existing)
      if (cleaned !== existing) {
        fs.writeFileSync(file, cleaned.replace(/\n{3,}/g, '\n\n'), 'utf8')
      }
    } catch { /* missing or unwritable -> nothing to remove */ }
  }
}
