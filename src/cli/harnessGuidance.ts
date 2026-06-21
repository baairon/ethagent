export type PortableInstructionOptions = {
  harness: string
  soulMemoryLocation?: string
  skillsLocation?: string
}

export function buildPortableInstruction(opts: PortableInstructionOptions): string {
  const where =
    opts.soulMemoryLocation ??
    'the `<!-- ethagent:soul:start -->` and `<!-- ethagent:memory:start -->` blocks in this file'
  const skillsWhere = opts.skillsLocation ? `\`${opts.skillsLocation.replace(/\\/g, '/')}\`` : 'the `skills` folder next to this file'
  return (
    `ethagent portable identity is active for the ${opts.harness} harness. Keep this agent's soul and memory current by editing ` +
    `${where}: durable user and project facts go in the memory block; persona, voice, and standards go in the soul block. ` +
    'Edits between the markers are pulled into your encrypted onchain vault automatically. ethagent keeps everything in sync in ' +
    `the background; if you have paused it, resume with \`npx ethagent resume\`. This agent's skills and the files they bundle ` +
    `(scripts, assets) are mirrored read-only into ${skillsWhere}; when a skill refers to a file by a relative path, resolve it ` +
    "inside that skill's folder there. Do not hand-edit them (they are regenerated from the vault). To add or change a skill, " +
    'put its folder in the vault skills dir (NOT this read-only mirror): run `npx ethagent --vault-dir` to print the vault ' +
    "path, then create or edit the `<name>/SKILL.md` folder inside its `skills/` subdir."
  )
}
