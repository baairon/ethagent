import { homePath, makeInstructionFileAdapter } from './instructionFileAdapter.js'
import { pathExists } from './shared.js'

export const codexAdapter = makeInstructionFileAdapter({
  name: 'codex',
  description: 'Merge soul, memory, and skill content (public and private) into ~/.codex/AGENTS.md between ethagent markers.',
  filePath: () => homePath('.codex', 'AGENTS.md'),
  detect: () => pathExists(homePath('.codex', 'config.toml')),
})
