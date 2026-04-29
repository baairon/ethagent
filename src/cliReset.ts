import { createInterface } from 'node:readline/promises'
import { stdin as processStdin, stdout as processStdout, stderr as processStderr } from 'node:process'
import React from 'react'
import { render } from 'ink'
import {
  createFactoryResetPlan,
  formatFactoryResetPlan,
  runFactoryReset,
  type FactoryResetPlan,
} from './storage/factoryReset.js'
import { AppInputProvider } from './input/AppInputProvider.js'
import { ResetConfirmView } from './ui/ResetConfirmView.js'

export type ResetCommandIO = {
  write?: (text: string) => void
  writeError?: (text: string) => void
  readConfirmation?: () => Promise<string>
  clearSecrets?: boolean
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

export async function runResetCommand(args: string[] = [], io: ResetCommandIO = {}): Promise<number> {
  const write = io.write ?? (text => { processStdout.write(text) })
  const writeError = io.writeError ?? (text => { processStderr.write(text) })
  const yes = args.includes('--yes') || args.includes('-y')
  const unknown = args.filter(arg => arg !== '--yes' && arg !== '-y')
  if (unknown.length > 0) {
    writeError(`unknown reset option: ${unknown[0]}\nusage: ethagent reset [--yes]\n`)
    return 2
  }

  const plan = await createFactoryResetPlan()

  if (!yes) {
    const confirmed = io.readConfirmation
      ? await readTextConfirmation(plan, io)
      : await readInkConfirmation(plan, io)
    if (!confirmed) {
      write('factory reset cancelled.\n')
      return 1
    }
  } else {
    write(`${formatFactoryResetPlan(plan)}\n`)
  }

  const result = await runFactoryReset({ clearSecrets: io.clearSecrets })
  write([
    'factory reset complete.',
    `deleted ${result.deletedPaths.length} local path${result.deletedPaths.length === 1 ? '' : 's'}.`,
    `cleared ${result.clearedSecretAccounts.length} known secret account${result.clearedSecretAccounts.length === 1 ? '' : 's'}.`,
    result.preservedPaths.length > 0
      ? `preserved local LLM assets: ${result.preservedPaths.length} path${result.preservedPaths.length === 1 ? '' : 's'}.`
      : 'no local model assets were present.',
    '',
  ].join('\n'))
  return 0
}

async function readTextConfirmation(plan: FactoryResetPlan, io: ResetCommandIO): Promise<boolean> {
  ;(io.write ?? (text => { processStdout.write(text) }))(`${formatFactoryResetPlan(plan)}\n`)
  const answer = await readConfirmation(io)
  return answer.trim().toLowerCase() === 'confirm'
}

async function readInkConfirmation(plan: FactoryResetPlan, io: ResetCommandIO): Promise<boolean> {
  let confirmed = false
  const instance = render(
    React.createElement(
      AppInputProvider,
      null,
      React.createElement(ResetConfirmView, {
        plan,
        onDone: (value: boolean) => { confirmed = value },
      }),
    ),
    {
      exitOnCtrlC: false,
      stdin: (io.input ?? processStdin) as typeof processStdin,
      stdout: (io.output ?? processStdout) as typeof processStdout,
    },
  )
  try {
    await instance.waitUntilExit()
  } catch {
    return false
  }
  return confirmed
}

async function readConfirmation(io: ResetCommandIO): Promise<string> {
  if (io.readConfirmation) {
    ;(io.write ?? (text => { processStdout.write(text) }))('type confirm to wipe local ethagent data: ')
    return io.readConfirmation()
  }

  const rl = createInterface({
    input: io.input ?? processStdin,
    output: io.output ?? processStdout,
  })
  try {
    return await rl.question('type confirm to wipe local ethagent data: ')
  } finally {
    rl.close()
  }
}
