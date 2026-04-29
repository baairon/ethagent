import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { TextInput } from '../../ui/TextInput.js'
import { theme } from '../../ui/theme.js'
import type { Step } from '../identityHubReducer.js'

type EditProfileFlowProps = {
  step: Extract<Step, { kind: 'edit-profile-name' | 'edit-profile-description' }>
  onNameSubmit: (name: string) => void
  onDescriptionSubmit: (description: string) => void
  onBack: () => void
  onMenu: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

export const EditProfileFlow: React.FC<EditProfileFlowProps> = ({ step, onNameSubmit, onDescriptionSubmit, onBack, onMenu }) => {
  if (step.kind === 'edit-profile-name') {
    const currentName = readStateString(step.identity.state, 'name')
    return (
      <Surface
        title="Rename Agent Identity"
        subtitle="This updates token metadata and generated MD headers."
        footer={footerHint('enter continues - esc back')}
      >
        <Text color={theme.dim}>Currently: {currentName || '(unnamed)'}</Text>
        <TextInput
          key="edit-profile-name"
          initialValue={currentName}
          placeholder="agent name"
          validate={value => value.trim().length >= 2 ? null : 'name must be at least 2 characters'}
          onSubmit={value => onNameSubmit(value.trim())}
          onCancel={onMenu}
        />
      </Surface>
    )
  }

  const currentDescription = readStateString(step.identity.state, 'description')
  return (
    <Surface
      title="Describe Agent Identity"
      subtitle="This updates token metadata and generated MD headers."
      footer={footerHint('enter saves - esc back')}
    >
      <Text color={theme.dim}>Currently: {currentDescription || '(no description)'}</Text>
      <TextInput
        key="edit-profile-description"
        initialValue={currentDescription}
        placeholder="description"
        allowEmpty
        onSubmit={value => onDescriptionSubmit(value.trim())}
        onCancel={onBack}
      />
    </Surface>
  )
}

function readStateString(state: Record<string, unknown> | undefined, key: string): string {
  const value = state?.[key]
  return typeof value === 'string' ? value : ''
}
