import React from 'react'
import { clearPinataJwt, savePinataJwt } from '../../storage/pinataJwt.js'
import { StorageCredentialScreen } from './StorageCredentialScreen.js'
import type { Step } from '../reducer.js'
import type { IdentityManagerController } from '../useController.js'

type StepOf<K extends Step['kind']> = Extract<Step, { kind: K }>

type StorageStep = StepOf<
  | 'storage-credential'
  | 'storage-credential-input'
  | 'storage-credential-forget-confirm'
>

export function isStorageStep(step: Step): step is StorageStep {
  return step.kind === 'storage-credential'
    || step.kind === 'storage-credential-input'
    || step.kind === 'storage-credential-forget-confirm'
}

type StorageRoutesProps = {
  controller: IdentityManagerController
  footer: React.ReactNode
}

export const StorageRoutes: React.FC<StorageRoutesProps> = ({ controller, footer }) => {
  const { step, jwtSaved, setStep, setJwtSaved, setCopyNotice, back } = controller

  if (!isStorageStep(step)) return null

  return (
    <StorageCredentialScreen
      step={step}
      hasCredential={jwtSaved}
      footer={footer}
      onEdit={() => setStep({ kind: 'storage-credential-input' })}
      onForget={() => setStep({ kind: 'storage-credential-forget-confirm' })}
      onConfirmForget={async () => {
        await clearPinataJwt().catch(() => {})
        setJwtSaved(false)
        setCopyNotice('IPFS storage credential removed.')
        setStep({ kind: 'menu' })
      }}
      onSubmit={async input => {
        try {
          await savePinataJwt(input)
          setJwtSaved(true)
          setCopyNotice('IPFS storage credential saved.')
          setStep({ kind: 'menu' })
        } catch (err: unknown) {
          setStep({ kind: 'storage-credential-input', error: (err as Error).message })
        }
      }}
      onCancel={back}
    />
  )
}
