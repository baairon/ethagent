import React from 'react'
import type { EthagentConfig } from '../storage/config.js'
import type { PermissionDecision, PermissionRequest, SessionPermissionRule } from '../tools/contracts.js'
import { type ModelPickerSelection, ModelPicker } from './ModelPicker.js'
import type { ModelPickerContextFit } from './modelPickerOptions.js'
import { ResumeView } from './ResumeView.js'
import { RewindView } from './RewindView.js'
import { PermissionsView } from './PermissionsView.js'
import { CopyPicker } from './CopyPicker.js'
import { PermissionPrompt } from './PermissionPrompt.js'
import { PlanApprovalView, type PlanApprovalAction } from './PlanApprovalView.js'
import { ChatInput } from './ChatInput.js'
import { IdentityHub, type IdentityHubInitialAction, type IdentityHubResult } from '../identity/IdentityHub.js'
import type { CopyResult } from '../utils/clipboard.js'
import { getSlashSuggestions } from '../commands/index.js'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { Spinner } from './Spinner.js'
import { ContextLimitView, type ContextLimitAction } from './ContextLimitView.js'
import type { ContextUsage } from '../runtime/compaction.js'

export type Overlay = 'none' | 'modelPicker' | 'resume' | 'rewind' | 'copyPicker' | 'permission' | 'permissions' | 'planApproval' | 'identity' | 'contextLimit'
export type CopyPickerState = { turnText: string; turnLabel: string } | null
export type IdentityOverlayState = {
  initialAction: IdentityHubInitialAction | undefined
  existing: { address: string } | null
}
export type ContextLimitState = {
  usage: ContextUsage
  prompt: string
} | null

type ChatBottomPaneProps = {
  overlay: Overlay
  config: EthagentConfig
  sessionId: string
  cwd: string
  currentSessionId: string
  copyPickerState: CopyPickerState
  contextLimitState: ContextLimitState
  modelPickerContextFit: ModelPickerContextFit | null
  permissionRequest: PermissionRequest | null
  history: string[]
  busy: boolean
  streaming: boolean
  placeholderHints: string[]
  queuedInputs: string[]
  slashSuggestions: ReturnType<typeof getSlashSuggestions>
  planApprovalContextLabel: string
  footerRight: React.ReactNode
  handleModelPick: (sel: ModelPickerSelection) => void | Promise<void>
  handleModelPickerCancel: () => void
  handleResumePick: (id: string) => void | Promise<void>
  identityOverlay: IdentityOverlayState | null
  handleIdentityResult: (result: IdentityHubResult) => void
  handleRestoreConversation: (turnId: string) => void
  handleCopyDone: (result: CopyResult, label: string) => void
  handleCopyCancel: () => void
  resolvePermission: (decision: PermissionDecision) => void
  handlePlanApproval: (action: PlanApprovalAction) => void | Promise<void>
  handlePlanApprovalCancel: () => void
  handleContextLimitAction: (action: ContextLimitAction) => void | Promise<void>
  handleContextLimitCancel: () => void
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
  modelPickerContextFit,
  permissionRequest,
  history,
  busy,
  streaming,
  placeholderHints,
  queuedInputs,
  slashSuggestions,
  planApprovalContextLabel,
  footerRight,
  handleModelPick,
  handleModelPickerCancel,
  handleResumePick,
  identityOverlay,
  handleIdentityResult,
  handleRestoreConversation,
  handleCopyDone,
  handleCopyCancel,
  resolvePermission,
  handlePlanApproval,
  handlePlanApprovalCancel,
  handleContextLimitAction,
  handleContextLimitCancel,
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
        cwd={cwd}
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

  return (
    <Box flexDirection="column" width="100%">
      {streaming ? (
        <Box marginLeft={2} marginBottom={1}>
          <Spinner active hint="esc to cancel" />
        </Box>
      ) : null}
      <ChatInput
        onSubmit={handleSubmit}
        history={history}
        disabled={busy}
        placeholderHints={placeholderHints}
        queuedMessages={queuedInputs}
        slashSuggestions={slashSuggestions}
        footerRight={footerRight}
        cwd={cwd}
      />
      <Box marginLeft={2} marginTop={0} flexDirection="column">
        <Text>
          <Text color={theme.dim}>workspace · </Text>
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
