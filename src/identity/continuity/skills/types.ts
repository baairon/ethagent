export type SkillVisibility = 'private' | 'public' | 'discoverable'

export type SkillFrontmatter = {
  name?: string
  description?: string
  whenToUse?: string
  version?: string
  argumentHint?: string
  tags?: string[]
  visibility?: SkillVisibility
}

export type SkillIndexEntry = {
  name: string
  displayName?: string
  description: string
  whenToUse?: string
  version?: string
  argumentHint?: string
  tags?: string[]
  visibility: SkillVisibility
  relativePath: string
  absolutePath: string
}

export type Skill = SkillIndexEntry & {
  body: string
}

export type ContinuitySkillsTree = Record<string, string>
