import type { SkillVisibility } from './types.js'

export type SkillScaffoldArgs = {
  name: string
  visibility?: SkillVisibility
}

export function defaultSkillScaffold({ name, visibility = 'public' }: SkillScaffoldArgs): string {
  return [
    '---',
    `name: ${name}`,
    'description: <one-line public description before publishing>',
    `visibility: ${visibility}`,
    '---',
    '',
    '# Overview',
    '',
    'Replace this draft with one or two sentences describing what this skill does and the problem it solves.',
    '',
    '# When to use',
    '',
    'State the trigger condition the agent should match against the user request.',
    'Keep this in sync with the description field above.',
    '',
    '# Instructions',
    '',
    '1. First concrete step.',
    '2. Second concrete step.',
    '3. Output format requirements.',
    '',
    '# Examples',
    '',
    '<example>',
    'Input: ...',
    'Output: ...',
    '</example>',
    '',
    '# Notes',
    '',
    'Edge cases, anti-triggers (when not to use this skill), and pointers to related skills.',
    'Reference supporting files in this skill folder with relative markdown links.',
    '',
  ].join('\n')
}

export function isDraftScaffold(entry: { description: string; name: string }): boolean {
  const desc = entry.description?.trim() ?? ''
  if (desc.length === 0) return true
  if (/^<.*>$/.test(desc)) return true
  if (desc === entry.name) return true
  if (/^overview$/i.test(desc)) return true
  if (/^describe in one or two sentences/i.test(desc)) return true
  if (/^replace this draft/i.test(desc)) return true
  return false
}
