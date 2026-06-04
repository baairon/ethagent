import React from 'react'
import { SkillsTreeScreen } from './SkillsTreeScreen.js'
import { SkillActionsScreen } from './SkillActionsScreen.js'
import { DeleteSkillConfirmScreen } from './DeleteSkillConfirmScreen.js'
import type { Step } from '../../reducer.js'
import type { IdentityManagerController } from '../../useController.js'

type StepOf<K extends Step['kind']> = Extract<Step, { kind: K }>

type SkillsStep = StepOf<
  | 'continuity-skills-tree'
  | 'continuity-skill-actions'
  | 'continuity-skill-delete-confirm'
>

export function isSkillsStep(step: Step): step is SkillsStep {
  return step.kind === 'continuity-skills-tree'
    || step.kind === 'continuity-skill-actions'
    || step.kind === 'continuity-skill-delete-confirm'
}

type SkillsRoutesProps = {
  controller: IdentityManagerController
  footer: React.ReactNode
}

export const SkillsRoutes: React.FC<SkillsRoutesProps> = ({ controller, footer }) => {
  const {
    config,
    identity,
    step,
    workingStatus,
    setStep,
    back,
    openSkillFile,
    openSkillsFolder,
    deleteSkill,
    setSkillVisibility,
  } = controller

  if (step.kind === 'continuity-skills-tree') {
    return (
      <SkillsTreeScreen
        identity={identity}
        config={config}
        workingStatus={workingStatus}
        notice={step.notice}
        editorOpened={step.editorOpened}
        footer={footer}
        onOpenSkill={relativePath => setStep({ kind: 'continuity-skill-actions', relativePath })}
        onOpenFolder={() => { void openSkillsFolder() }}
        onBack={back}
      />
    )
  }

  if (step.kind === 'continuity-skill-actions') {
    return (
      <SkillActionsScreen
        identity={identity}
        relativePath={step.relativePath}
        {...(step.notice ? { notice: step.notice } : {})}
        footer={footer}
        onOpenSkill={relativePath => { void openSkillFile(relativePath) }}
        onSetVisibility={(relativePath, visibility) => { void setSkillVisibility(relativePath, visibility) }}
        onDelete={relativePath => setStep({ kind: 'continuity-skill-delete-confirm', target: { kind: 'skill', relativePath } })}
        onBack={back}
      />
    )
  }

  if (step.kind === 'continuity-skill-delete-confirm') {
    return (
      <DeleteSkillConfirmScreen
        identity={identity}
        target={step.target}
        footer={footer}
        onConfirm={() => { void deleteSkill(step.target.relativePath) }}
        onCancel={back}
      />
    )
  }

  return null
}
