import React from 'react'
import type { EthagentConfig } from '../storage/config.js'
import type { PermissionDecision, PermissionRequest, SessionPermissionRule } from '../tools/contracts.js'
import { type ModelPickerSelection, ModelPicker } from '../models/ModelPicker.js'
import type { ModelPickerContextFit } from '../models/modelPickerOptions.js'
import { ResumeView } from './views/ResumeView.js'
import { RewindView } from './views/RewindView.js'
import { PermissionsView } from './views/PermissionsView.js'
import { CopyPicker } from './views/CopyPicker.js'
import { PermissionPrompt } from './views/PermissionPrompt.js'
import { PlanApprovalView, type PlanApprovalAction } from './views/PlanApprovalView.js'
import { ChatInput } from './input/ChatInput.js'
import { IdentityHub, type IdentityHubInitialAction, type IdentityHubResult } from '../identity/hub/IdentityHub.js'
import type { CopyResult } from '../utils/clipboard.js'
import { getSlashSuggestions } from './commands.js'
import { modelSupportsImages } from '../utils/images.js'
import { Box, Text } from 'ink'
import { theme } from '../ui/theme.js'
import { Spinner } from '../ui/Spinner.js'
import { ContextLimitView, type ContextLimitAction } from './views/ContextLimitView.js'
import type { ContextUsage } from '../runtime/compaction.js'
import {
  ContinuityEditReviewView,
  type ContinuityEditReviewAction,
  type ContinuityEditReviewState,
} from './views/ContinuityEditReviewView.js'

export type Overlay = 'none' | 'modelPicker' | 'resume' | 'rewind' | 'copyPicker' | 'permission' | 'permissions' | 'planApproval' | 'identity' | 'contextLimit' | 'continuityEditReview'
export type CopyPickerState = { turnText: string; turnLabel: string } | null
export type IdentityOverlayState = {
  initialAction: IdentityHubInitialAction | undefined
  existing: { address: string } | null
}
export type ContextLimitState = {
  usage: ContextUsage
  prompt: string
} | null

export type BottomPaneActivity = {
  label: string
  hint?: string
} | null

type ChatBottomPaneProps = {
  overlay: Overlay
  config: EthagentConfig
  sessionId: string
  cwd: string
  currentSessionId: string
  copyPickerState: CopyPickerState
  contextLimitState: ContextLimitState
  continuityEditReview: ContinuityEditReviewState | null
  modelPickerContextFit: ModelPickerContextFit | null
  permissionRequest: PermissionRequest | null
  history: string[]
  streaming: boolean
  streamingStartedAt: number | null
  activity: BottomPaneActivity
  placeholderHints: string[]
  queuedInputs: string[]
  slashSuggestions: ReturnType<typeof getSlashSuggestions>
  planApprovalContextLabel: string
  footerRight: React.ReactNode
  handleModelPick: (sel: ModelPickerSelection) => void | Promise<void>
  handleModelPickerCancel: () => void
  handleResumePick: (id: string) => void | Promise<void>
  handleResumeClearAll: () => void | Promise<void>
  identityOverlay: IdentityOverlayState | null
  handleIdentityResult: (result: IdentityHubResult) => void
  handleRestoreConversation: (turnId: string, promptText?: string) => void
  pendingInputDraft: string | null
  onInputDraftConsumed: () => void
  handleSummarizeFromTurn: (turnId: string) => void | Promise<unknown>
  handleCopyDone: (result: CopyResult, label: string) => void
  handleCopyCancel: () => void
  resolvePermission: (decision: PermissionDecision) => void
  handlePlanApproval: (action: PlanApprovalAction) => void | Promise<void>
  handlePlanApprovalCancel: () => void
  handleContextLimitAction: (action: ContextLimitAction) => void | Promise<void>
  handleContextLimitCancel: () => void
  handleContinuityEditReviewAction: (action: ContinuityEditReviewAction) => void | Promise<void>
  handleContinuityEditReviewCancel: () => void
  onPermissionRulesChanged: (rules: SessionPermissionRule[]) => void
  onConfigChange: (config: EthagentConfig) => void
  handleSubmit: (value: string) => void | Promise<void>
  setOverlay: React.Dispatch<React.SetStateAction<Overlay>>
  pushNote: (text: string, kind?: 'info' | 'error' | 'dim') => void
}

export function ChatBottomPane({
  overlay,
  config,
  sessionId,
  cwd,
  currentSessionId,
  copyPickerState,
  contextLimitState,
  continuityEditReview,
  modelPickerContextFit,
  permissionRequest,
  history,
  streaming,
  streamingStartedAt,
  activity,
  placeholderHints,
  queuedInputs,
  slashSuggestions,
  planApprovalContextLabel,
  footerRight,
  handleModelPick,
  handleModelPickerCancel,
  handleResumePick,
  handleResumeClearAll,
  identityOverlay,
  handleIdentityResult,
  handleRestoreConversation,
  handleSummarizeFromTurn,
  pendingInputDraft,
  onInputDraftConsumed,
  handleCopyDone,
  handleCopyCancel,
  resolvePermission,
  handlePlanApproval,
  handlePlanApprovalCancel,
  handleContextLimitAction,
  handleContextLimitCancel,
  handleContinuityEditReviewAction,
  handleContinuityEditReviewCancel,
  onPermissionRulesChanged,
  onConfigChange,
  handleSubmit,
  setOverlay,
  pushNote,
}: ChatBottomPaneProps): React.ReactNode {
  if (overlay === 'modelPicker') {
    return (
      <ModelPicker
        currentConfig={config}
        currentProvider={config.provider}
        currentModel={config.model}
        contextFit={modelPickerContextFit}
        onPick={handleModelPick}
        onCancel={handleModelPickerCancel}
      />
    )
  }

  if (overlay === 'resume') {
    return (
      <ResumeView
        currentSessionId={sessionId}
        onResume={handleResumePick}
        onClearAll={handleResumeClearAll}
        onCancel={() => setOverlay('none')}
      />
    )
  }

  if (overlay === 'rewind') {
    return (
      <RewindView
        cwd={cwd}
        currentSessionId={currentSessionId}
        onRestoreConversation={handleRestoreConversation}
        onSummarizeFromTurn={handleSummarizeFromTurn}
        onDone={(message, variant = 'info') => {
          setOverlay('none')
          pushNote(message, variant)
        }}
        onCancel={() => setOverlay('none')}
      />
    )
  }

  if (overlay === 'permissions') {
    return (
      <PermissionsView
        cwd={cwd}
        onRulesChanged={onPermissionRulesChanged}
        onNotice={(message, variant = 'info') => {
          pushNote(message, variant)
        }}
        onCancel={() => setOverlay('none')}
      />
    )
  }

  if (overlay === 'copyPicker' && copyPickerState) {
    return (
      <CopyPicker
        turnText={copyPickerState.turnText}
        turnLabel={copyPickerState.turnLabel}
        onDone={handleCopyDone}
        onCancel={handleCopyCancel}
      />
    )
  }

  if (overlay === 'permission' && permissionRequest) {
    return (
      <PermissionPrompt
        request={permissionRequest}
        onDecision={resolvePermission}
        onCancel={() => resolvePermission('deny')}
      />
    )
  }

  if (overlay === 'identity' && identityOverlay) {
    return (
      <IdentityHub
        mode="manage"
        config={config}
        initialAction={identityOverlay.initialAction}
        onComplete={handleIdentityResult}
        onConfigChange={onConfigChange}
      />
    )
  }

  if (overlay === 'planApproval') {
    return (
      <PlanApprovalView
        contextLabel={planApprovalContextLabel}
        onSelect={handlePlanApproval}
        onCancel={handlePlanApprovalCancel}
      />
    )
  }

  if (overlay === 'contextLimit' && contextLimitState) {
    return (
      <ContextLimitView
        usage={contextLimitState.usage}
        promptPreview={summarizePrompt(contextLimitState.prompt)}
        onSelect={handleContextLimitAction}
        onCancel={handleContextLimitCancel}
      />
    )
  }

  if (overlay === 'continuityEditReview' && continuityEditReview) {
    return (
      <ContinuityEditReviewView
        review={continuityEditReview}
        onSelect={handleContinuityEditReviewAction}
        onCancel={handleContinuityEditReviewCancel}
      />
    )
  }

  return (
    <Box flexDirection="column" width="100%">
      {activity ? (
        <Box marginLeft={2} marginBottom={1}>
          <Spinner active label={activity.label} hint={activity.hint} />
        </Box>
      ) : streaming ? (
        <Box marginLeft={2} marginBottom={1}>
          <Spinner active hint="esc to cancel" startedAt={streamingStartedAt ?? undefined} />
        </Box>
      ) : null}
      <ChatInput
        onSubmit={handleSubmit}
        history={history}
        placeholderHints={placeholderHints}
        queuedMessages={queuedInputs}
        slashSuggestions={slashSuggestions}
        footerRight={footerRight}
        cwd={cwd}
        seedText={pendingInputDraft}
        onSeedConsumed={onInputDraftConsumed}
        onImagePaste={() => {
          if (!modelSupportsImages(config.provider, config.model, { mmprojPath: config.localMmprojPath })) {
            const hint = config.provider === 'llamacpp'
              ? ' · run "Add Vision Encoder" in alt+p to enable image input on this model'
              : ' · switch via alt+p'
            pushNote(`current model "${config.model}" does not accept image input${hint}`, 'error')
          }
        }}
      />
      <Box marginLeft={2} marginTop={0} flexDirection="column">
        <Text>
          <Text color={theme.dim}>Workspace · </Text>
          <Text color={theme.textSubtle}>{cwd}</Text>
        </Text>
      </Box>
    </Box>
  )
}

function summarizePrompt(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 100) return normalized
  return `${normalized.slice(0, 97)}...`
}
