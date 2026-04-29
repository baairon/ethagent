import { createInterface } from 'node:readline/promises'
import { stdin as processStdin, stdout as processStdout, stderr as processStderr } from 'node:process'
import {
  createFactoryResetPlan,
  formatFactoryResetPlan,
  runFactoryReset,
} from './storage/factoryReset.js'

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
  write(`${formatFactoryResetPlan(plan)}\n`)

  if (!yes) {
    const answer = await readConfirmation(io)
    if (answer.trim().toLowerCase() !== 'confirm') {
      write('factory reset cancelled.\n')
      return 1
    }
  }

  const result = await runFactoryReset({ clearSecrets: io.clearSecrets })
  write([
    'factory reset complete.',
    `deleted ${result.deletedPaths.length} local path${result.deletedPaths.length === 1 ? '' : 's'}.`,
    `cleared ${result.clearedSecretAccounts.length} known secret account${result.clearedSecretAccounts.length === 1 ? '' : 's'}.`,
    result.preservedPaths.length > 0
      ? `preserved local model assets: ${result.preservedPaths.length} path${result.preservedPaths.length === 1 ? '' : 's'}.`
      : 'no local model assets were present.',
    '',
  ].join('\n'))
  return 0
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
