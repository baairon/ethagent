import { readOperatorKey } from '../operatorKey.js'
import { defaultHistoryDeps, type HistoryDeps } from './shared.js'

export async function runHistoryCommand(verb: string, args: string[], baseDeps: HistoryDeps = defaultHistoryDeps()): Promise<number> {
  const deps: HistoryDeps = { ...baseDeps, operatorKey: baseDeps.operatorKey ?? readOperatorKey(baseDeps.env) }
  switch (verb) {
    case 'status': return (await import('./status.js')).runStatusCommand(args, deps)
    case 'history': return (await import('./log.js')).runHistoryLog(args, deps)
    case 'show': return (await import('./show.js')).runShowCommand(args, deps)
    case 'diff': return (await import('./diff.js')).runDiffCommand(args, deps)
    case 'fetch': return (await import('./fetch.js')).runFetchCommand(args, deps)
    case 'checkpoint': return (await import('./checkpoint.js')).runCheckpointCommand(args, deps)
    case 'rollback': return (await import('./rollback.js')).runRollbackCommand(args, deps)
    case 'forget': return (await import('./forget.js')).runForgetCommand(args, deps)
    case 'skills': return (await import('./skills.js')).runSkillsCommand(args, deps)
    default: return 2
  }
}
