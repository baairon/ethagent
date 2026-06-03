import React from 'react'
import { render } from 'ink'
import { stdout, stderr } from 'node:process'
import { ResetConfirmView } from './ResetConfirmView.js'
import { resetPlan, runReset, type ResetPlan } from '../storage/reset.js'
import { clearHarnessManagedBlocks } from './syncAdapters/index.js'
import { removeClaudeHooks } from './syncAdapters/claude-code.js'
import { uninstallAutostart } from './autostart.js'
import { stopDaemon } from './daemon.js'

export async function runResetCommand(args: string[] = []): Promise<number> {
  const yes = args.includes('--yes') || args.includes('-y')
  const unknown = args.filter(a => a !== '--yes' && a !== '-y')
  if (unknown.length > 0) {
    stderr.write(`unknown reset option: ${unknown[0]}\nusage: ethagent reset [--yes]\n`)
    return 2
  }

  const plan = resetPlan()

  if (yes) {
    stdout.write(`Resetting ethagent: ${plan.configDir} and ${plan.secretAccounts.length} secret${plan.secretAccounts.length === 1 ? '' : 's'}.\n`)
    if (plan.preservedAccounts.length > 0) {
      stdout.write(`Preserving IPFS storage credential (${plan.preservedAccounts.join(', ')}); re-setup not needed.\n`)
    }
    await runReset()
    await finishReset()
    return 0
  }

  const confirmed = await confirmWithInk(plan)
  if (!confirmed) {
    stdout.write('Reset cancelled.\n')
    return 1
  }
  await runReset()
  await finishReset()
  return 0
}

async function finishReset(): Promise<void> {
  stopDaemon()
  uninstallAutostart()
  await removeClaudeHooks()
  const cleared = await clearHarnessManagedBlocks()
  if (cleared.length > 0) {
    stdout.write(`Cleared ethagent markers from ${cleared.length} file${cleared.length === 1 ? '' : 's'}.\n`)
  }
  stdout.write('Reset complete. Run ethagent to create or link an agent identity.\n')
}

async function confirmWithInk(plan: ResetPlan): Promise<boolean> {
  let confirmed = false
  const instance = render(
    React.createElement(ResetConfirmView, {
      plan,
      onDone: (value: boolean) => { confirmed = value },
    }),
    { exitOnCtrlC: false },
  )
  try {
    await instance.waitUntilExit()
  } catch {
    return false
  }
  return confirmed
}
