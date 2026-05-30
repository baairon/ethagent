import React from 'react'
import { render } from 'ink'
import { stdout, stderr } from 'node:process'
import { AppInputProvider } from '../app/input/AppInputProvider.js'
import { ResetConfirmView } from './ResetConfirmView.js'
import { resetPlan, runReset } from '../storage/reset.js'
import { clearHarnessManagedBlocks } from './syncAdapters/index.js'

export async function runResetCommand(args: string[] = []): Promise<number> {
  const yes = args.includes('--yes') || args.includes('-y')
  const unknown = args.filter(a => a !== '--yes' && a !== '-y')
  if (unknown.length > 0) {
    stderr.write(`unknown reset option: ${unknown[0]}\nusage: ethagent reset [--yes]\n`)
    return 2
  }

  const plan = resetPlan()

  if (yes) {
    stdout.write(`Resetting ethagent: ${plan.configDir} and ${plan.secretAccounts.length} secrets.\n`)
    await runReset()
    await finishReset()
    return 0
  }

  const confirmed = await confirmWithInk(plan.configDir, plan.secretAccounts)
  if (!confirmed) {
    stdout.write('Reset cancelled.\n')
    return 1
  }
  await runReset()
  await finishReset()
  return 0
}

async function finishReset(): Promise<void> {
  const cleared = await clearHarnessManagedBlocks()
  if (cleared.length > 0) {
    stdout.write(`Cleared ethagent markers from ${cleared.length} file${cleared.length === 1 ? '' : 's'}.\n`)
  }
  stdout.write('Reset complete. Run ethagent to create or link an agent identity.\n')
}

async function confirmWithInk(configDir: string, secretAccounts: string[]): Promise<boolean> {
  let confirmed = false
  const instance = render(
    React.createElement(
      AppInputProvider,
      null,
      React.createElement(ResetConfirmView, {
        plan: { configDir, secretAccounts },
        onDone: (value: boolean) => { confirmed = value },
      }),
    ),
    { exitOnCtrlC: false },
  )
  try {
    await instance.waitUntilExit()
  } catch {
    return false
  }
  return confirmed
}
