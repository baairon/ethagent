import { readOperatorKey } from '../operatorKey.js'
import { defaultHistoryDeps, type HistoryDeps } from '../history/shared.js'

export async function runOnchainCommand(verb: string, args: string[], baseDeps: HistoryDeps = defaultHistoryDeps()): Promise<number> {
  const deps: HistoryDeps = { ...baseDeps, operatorKey: baseDeps.operatorKey ?? readOperatorKey(baseDeps.env) }
  switch (verb) {
    case 'custody': return (await import('./custody.js')).runCustodyCommand(args, deps)
    case 'ens': return (await import('./ens.js')).runEnsCommand(args, deps)
    case 'restore': return (await import('./restore.js')).runRestoreCommand(args, deps)
    case 'profile': return (await import('./profile.js')).runProfileCommand(args, deps)
    default: return 2
  }
}
