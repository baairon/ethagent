import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { theme } from '../../../ui/theme.js'
import type { Step } from '../identityHubReducer.js'

type EditProfileFlowProps = {
  step: Extract<Step, { kind: 'edit-profile-name' | 'edit-profile-description' | 'edit-profile-image' }>
  onNameSubmit: (name: string) => void
  onDescriptionSubmit: (description: string) => void
  onImageSubmit: (imagePath: string) => void
  onImagePick: () => void
  onBack: () => void
  onMenu: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

export const EditProfileFlow: React.FC<EditProfileFlowProps> = ({
  step,
  onNameSubmit,
  onDescriptionSubmit,
  onImageSubmit,
  onImagePick,
  onBack,
  onMenu,
}) => {
  const [manualImagePath, setManualImagePath] = React.useState(false)

  if (step.kind === 'edit-profile-name') {
    const currentName = readStateString(step.identity.state, 'name')
    return (
      <Surface
        title="Rename Agent Identity"
        subtitle="This updates public token metadata and the Agent Card."
        footer={footerHint('enter continues · esc back')}
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

  if (step.kind === 'edit-profile-image') {
    const currentImage = readStateString(step.identity.state, 'imageUrl')
    if (!manualImagePath) {
      return (
        <Surface
          title="Upload Agent Image"
          subtitle="Choose a local image. ethagent uploads it to IPFS and attaches it to token metadata."
          footer={footerHint('enter select · esc back')}
        >
          <Box flexDirection="column">
            <Text color={theme.dim}>Current: {currentImage || '(no image)'}</Text>
            {step.error ? <Text color="#e87070">{step.error}</Text> : null}
          </Box>
          <Box marginTop={1}>
            <Select<'choose' | 'manual' | 'skip' | 'delete' | 'back'>
              options={[
                { value: 'choose', role: 'section', prefix: '--', label: 'Image' },
                { value: 'choose', label: 'Choose Image File', hint: 'Open the operating system file picker' },
                { value: 'manual', label: 'Enter Path Manually', hint: 'Fallback if a file picker is unavailable' },
                ...(currentImage ? [{ value: 'delete' as const, label: 'Delete Current Image', hint: 'Remove the attached image from public profile' }] : []),
                { value: 'skip', label: currentImage ? 'Keep Current Image' : 'No Image', hint: 'Save without changing the image' },
                { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
                { value: 'back', label: 'Back', hint: 'Return to description', role: 'utility' },
              ]}
              hintLayout="inline"
              onSubmit={choice => {
                if (choice === 'choose') return onImagePick()
                if (choice === 'manual') return setManualImagePath(true)
                if (choice === 'delete') return onImageSubmit('delete')
                if (choice === 'skip') return onImageSubmit('')
                return onBack()
              }}
              onCancel={onBack}
            />
          </Box>
        </Surface>
      )
    }
    return (
      <Surface
        title="Enter Image Path"
        subtitle="Fallback path entry. URLs are rejected because ethagent uploads the local file itself."
        footer={footerHint('enter saves · esc back')}
      >
        <Text color={theme.dim}>Current: {currentImage || '(no image)'}</Text>
        <TextInput
          key="edit-profile-image"
          placeholder="local image path"
          allowEmpty
          validate={value => validateImagePath(value)}
          onSubmit={value => onImageSubmit(value.trim())}
          onCancel={() => setManualImagePath(false)}
        />
      </Surface>
    )
  }

  const currentDescription = readStateString(step.identity.state, 'description')
  return (
    <Surface
      title="Describe Agent Identity"
      subtitle="This updates public token metadata and the Agent Card."
      footer={footerHint('enter continues · esc back')}
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

function validateImagePath(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed) || /^ipfs:\/\//i.test(trimmed)) {
    return 'enter a local image file path; ethagent will upload it to IPFS'
  }
  if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(trimmed)) {
    return 'image must be png, jpg, gif, webp, or svg'
  }
  return null
}

function readStateString(state: Record<string, unknown> | undefined, key: string): string {
  const value = state?.[key]
  return typeof value === 'string' ? value : ''
}
