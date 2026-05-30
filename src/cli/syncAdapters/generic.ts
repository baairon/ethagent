import { mirrorAsSkillFolders, type PublicSkill } from './shared.js'
import type { SyncContext } from './index.js'

export function genericAdapter(targetRoot: string) {
  return {
    name: 'generic' as const,
    description: `Mirror public skills into ${targetRoot} as per-skill folders.`,
    async detect(): Promise<boolean> {
      return true
    },
    async mirror(skills: PublicSkill[], _context?: SyncContext): Promise<{ count: number; skipped: number }> {
      return mirrorAsSkillFolders(targetRoot, skills)
    },
  }
}
