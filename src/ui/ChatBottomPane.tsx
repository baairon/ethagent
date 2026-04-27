import React from 'react'
import type { EthagentConfig } from '../storage/config.js'
import type { PermissionDecision, PermissionRequest, SessionPermissionRule } from '../tools/contracts.js'
import { type ModelPickerSelection, ModelPicker } from './ModelPicker.js'
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

export type Overlay = 'none' | 'modelPicker' | 'resume' | 'rewind' | 'copyPicker' | 'permission' | 'permissions' | 'planApproval' | 'identity'
export type CopyPickerState = { turnText: string; turnLabel: string } | null
export type IdentityOverlayState = {
  initialAction: IdentityHubInitialAction | undefined
  existing: { address: string } | null
}

type ChatBottomPaneProps = {
  overlay: Overlay
  config: EthagentConfig
  sessionId: string
  cwd: string
  currentSessionId: string
  copyPickerState: CopyPickerState
  permissionRequest: PermissionRequest | null
  history: string[]
  busy: boolean
  streaming: boolean
  placeholderHints: string[]
  queuedInputs: string[]
  slashSuggestions: ReturnType<typeof getSlashSuggestions>
  planApprovalContextLabel: string
  footerRight: React.ReactNode
  exitHint: string | null
  handleModelPick: (sel: ModelPickerSelection) => void | Promise<void>
  handleResumePick: (id: string) => void | Promise<void>
  identityOverlay: IdentityOverlayState | null
  handleIdentityResult: (result: IdentityHubResult) => void
  handleRestoreConversation: (turnId: string) => void
  handleCopyDone: (result: CopyResult, label: string) => void
  handleCopyCancel: () => void
  resolvePermission: (decision: PermissionDecision) => void
  handlePlanApproval: (action: PlanApprovalAction) => void | Promise<void>
  handlePlanApprovalCancel: () => void
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
  permissionRequest,
  history,
  busy,
  streaming,
  placeholderHints,
  queuedInputs,
  slashSuggestions,
  planApprovalContextLabel,
  footerRight,
  exitHint,
  handleModelPick,
  handleResumePick,
  identityOverlay,
  handleIdentityResult,
  handleRestoreConversation,
  handleCopyDone,
  handleCopyCancel,
  resolvePermission,
  handlePlanApproval,
  handlePlanApprovalCancel,
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
        onPick={handleModelPick}
        onCancel={() => setOverlay('none')}
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
        {exitHint ? (
          <Text color={theme.accentPrimary}>{exitHint}</Text>
        ) : null}
      </Box>
    </Box>
  )
}
