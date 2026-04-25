import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Select } from '../ui/Select.js'
import { TextInput } from '../ui/TextInput.js'
import { theme } from '../ui/theme.js'
import { generatePrivateKey, addressFromPrivateKey, validatePrivateKey } from './eth.js'

export type IdentityResult =
  | { kind: 'set'; privateKey: string; address: string }
  | { kind: 'skip' }
  | { kind: 'cancel' }

type Step =
  | { kind: 'choose' }
  | { kind: 'create-confirm'; privateKey: string; address: string }
  | { kind: 'import' }
  | { kind: 'replace-confirm' }

type IdentitySetupProps = {
  mode: 'first-run' | 'manage'
  initialAction?: 'create' | 'import'
  existing?: { address: string } | null
  onComplete: (result: IdentityResult) => void
}

export const IdentitySetup: React.FC<IdentitySetupProps> = ({
  mode,
  initialAction,
  existing,
  onComplete,
}) => {
  const [step, setStep] = useState<Step>(() => {
    if (existing && initialAction) return { kind: 'replace-confirm' }
    if (initialAction === 'create') {
      const pk = generatePrivateKey()
      return { kind: 'create-confirm', privateKey: pk, address: addressFromPrivateKey(pk) }
    }
    if (initialAction === 'import') return { kind: 'import' }
    return { kind: 'choose' }
  })

  useEffect(() => {
    // no-op; placeholder for future async warm-ups
  }, [])

  if (step.kind === 'replace-confirm' && existing) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.accentSecondary} bold>
          {initialAction === 'create' ? 'replace existing identity?' : 'replace existing identity?'}
        </Text>
        <Text color={theme.dim}>
          current address: <Text color={theme.text}>{existing.address}</Text>
        </Text>
        <Text color="#e87070">
          this overwrites your stored private key. there is no undo.
        </Text>
        <Box marginTop={1}>
          <Select<'replace' | 'cancel'>
            options={[
              { value: 'cancel',  label: 'keep existing identity', hint: 'recommended' },
              { value: 'replace', label: 'replace it' },
            ]}
            onSubmit={choice => {
              if (choice === 'cancel') return onComplete({ kind: 'cancel' })
              if (initialAction === 'import') {
                setStep({ kind: 'import' })
              } else {
                const pk = generatePrivateKey()
                setStep({ kind: 'create-confirm', privateKey: pk, address: addressFromPrivateKey(pk) })
              }
            }}
            onCancel={() => onComplete({ kind: 'cancel' })}
          />
        </Box>
      </Box>
    )
  }

  if (step.kind === 'choose') {
    const intro = mode === 'first-run'
      ? 'set up your portable Ethereum identity? (optional)'
      : 'manage your Ethereum identity'
    type Action = 'create' | 'import' | 'skip'
    const skipLabel = mode === 'first-run' ? 'skip' : 'cancel'
    const skipHint = mode === 'first-run' ? 'do this later with /identity' : 'leave identity unchanged'
    const options = existing
      ? [
          { value: 'create' as Action, label: 'replace with new identity', hint: 'generates a fresh keypair' },
          { value: 'import' as Action, label: 'replace with imported key',  hint: 'paste a private key' },
          { value: 'skip'   as Action, label: skipLabel,                    hint: skipHint },
        ]
      : [
          { value: 'create' as Action, label: 'create new',      hint: 'generate a fresh keypair (recommended)' },
          { value: 'import' as Action, label: 'import existing', hint: 'paste a private key' },
          { value: 'skip'   as Action, label: skipLabel,         hint: skipHint },
        ]
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.accentSecondary} bold>{intro}</Text>
        <Text color={theme.dim}>
          your address is your portable agent identity. the private key stays on this machine,
          encrypted via your OS keyring when available.
        </Text>
        {existing ? (
          <Text color={theme.dim}>
            current address: <Text color={theme.text}>{existing.address}</Text>
          </Text>
        ) : null}
        <Box marginTop={1}>
          <Select<Action>
            options={options}
            onSubmit={choice => {
              if (choice === 'skip') return onComplete({ kind: 'skip' })
              if (existing) {
                setStep({ kind: 'replace-confirm' })
                if (choice === 'import') return
                return
              }
              if (choice === 'create') {
                const pk = generatePrivateKey()
                setStep({ kind: 'create-confirm', privateKey: pk, address: addressFromPrivateKey(pk) })
              } else {
                setStep({ kind: 'import' })
              }
            }}
            onCancel={() => onComplete({ kind: 'cancel' })}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.dim}>↑↓ navigate · enter select · esc back</Text>
        </Box>
      </Box>
    )
  }

  if (step.kind === 'create-confirm') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.accentSecondary} bold>new Ethereum identity</Text>
        <Text color={theme.dim}>this address is yours; it persists across machines once you back up the key.</Text>
        <Box marginTop={1}>
          <Text color={theme.text}>address  </Text>
          <Text color={theme.accentPrimary} bold>{step.address}</Text>
        </Box>
        <Box marginTop={1}>
          <Select<'save' | 'regen' | 'cancel'>
            options={[
              { value: 'save',   label: 'save this identity',   hint: 'private key encrypted via keyring' },
              { value: 'regen',  label: 'generate another' },
              { value: 'cancel', label: mode === 'first-run' ? 'skip identity setup' : 'cancel' },
            ]}
            onSubmit={choice => {
              if (choice === 'save') {
                onComplete({ kind: 'set', privateKey: step.privateKey, address: step.address })
                return
              }
              if (choice === 'regen') {
                const pk = generatePrivateKey()
                setStep({ kind: 'create-confirm', privateKey: pk, address: addressFromPrivateKey(pk) })
                return
              }
              onComplete({ kind: mode === 'first-run' ? 'skip' : 'cancel' })
            }}
            onCancel={() => onComplete({ kind: 'cancel' })}
          />
        </Box>
      </Box>
    )
  }

  if (step.kind === 'import') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.accentSecondary} bold>import private key</Text>
        <Text color={theme.dim}>paste a 64-character hex private key (with or without 0x prefix).</Text>
        <Text color={theme.dim}>stored encrypted via OS keyring when available; never written to config.json.</Text>
        <Box marginTop={1}>
          <TextInput
            isSecret
            placeholder="0x... or 64 hex chars"
            validate={v => validatePrivateKey(v.trim()) ? null : 'private key must be 32 valid hex bytes'}
            onSubmit={value => {
              const trimmed = value.trim()
              const pk = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`
              const address = addressFromPrivateKey(pk)
              onComplete({ kind: 'set', privateKey: pk, address })
            }}
            onCancel={() => setStep({ kind: 'choose' })}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.dim}>enter to import · esc to go back</Text>
        </Box>
      </Box>
    )
  }

  return null
}
