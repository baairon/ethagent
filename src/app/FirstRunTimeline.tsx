import React from 'react'
import { FlowTimeline } from '../identity/hub/shared/components/FlowTimeline.js'

export const FIRST_RUN_STAGES = ['Inspect', 'Identity', 'Model'] as const

export type FirstRunStepKind =
  | 'detecting'
  | 'detect-error'
  | 'identity-start'
  | 'identity-start-saving'
  | 'choose-path'
  | 'hf-setup'
  | 'cloud-provider'
  | 'cloud-openai-auth'
  | 'cloud-openai-oauth'
  | 'cloud-key'
  | 'cloud-key-saving'
  | 'cloud-model'
  | 'saving'
  | 'save-error'
  | 'done'

export function firstRunStageNumber(stepKind: FirstRunStepKind): number {
  switch (stepKind) {
    case 'detecting':
    case 'detect-error':
      return 1
    case 'identity-start':
    case 'identity-start-saving':
      return 2
    case 'choose-path':
    case 'hf-setup':
    case 'cloud-provider':
    case 'cloud-openai-auth':
    case 'cloud-openai-oauth':
    case 'cloud-key':
    case 'cloud-key-saving':
    case 'cloud-model':
      return 3
    case 'saving':
    case 'save-error':
    case 'done':
      return 4
    default:
      return 0
  }
}

export const FirstRunTimeline: React.FC<{ current: number }> = ({ current }) => (
  <FlowTimeline steps={[...FIRST_RUN_STAGES]} current={current} />
)
