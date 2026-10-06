import React from 'react'
import { type Address } from 'viem'
import {
  CheckingName,
  SubdomainEntry,
} from './EnsEditShared.js'
import {
  EnsSetupBlockedScreen,
  EnsSetupReviewScreen,
} from './EnsEditReviewScreens.js'
import type {
  EnsEditProps,
  EnsPhase,
} from './types.js'

type AdvancedScreenProps = {
  phase: EnsPhase
  ownerAddress: Address
  savedSubdomainLabel: string
  currentEnsName: string
  setPhase: (phase: EnsPhase) => void
  runAdvancedSubdomainCheck: (rootName: string, label: string) => void
  onEnsSetup: EnsEditProps['onEnsSetup']
  onEnsLink: EnsEditProps['onEnsLink']
}

export function renderAdvancedEnsPhase({
  phase,
  ownerAddress,
  savedSubdomainLabel,
  currentEnsName,
  setPhase,
  runAdvancedSubdomainCheck,
  onEnsSetup,
  onEnsLink,
}: AdvancedScreenProps): React.ReactNode | null {
  const pickParent = () => setPhase({ kind: 'pick-parent', mode: 'advanced' })

  if (phase.kind === 'advanced-root-check') {
    return (
      <CheckingName
        fullName={phase.rootName}
        subtitle="Confirming your owner wallet manages it and holds the agent token."
        onCancel={pickParent}
      />
    )
  }

  if (phase.kind === 'advanced-subdomain') {
    const rootName = phase.rootName
    return (
      <SubdomainEntry
        parent={rootName}
        pointsTo={ownerAddress}
        initialValue={phase.label || savedSubdomainLabel || ''}
        error={phase.error}
        onConfirm={label => runAdvancedSubdomainCheck(rootName, label)}
        onBack={pickParent}
      />
    )
  }

  if (phase.kind === 'advanced-subdomain-check') {
    return (
      <CheckingName
        fullName={`${phase.label}.${phase.rootName}`}
        onCancel={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.rootName, label: phase.label })}
      />
    )
  }

  if (phase.kind === 'advanced-review') {
    return (
      <EnsSetupReviewScreen
        setup={phase.setup}
        currentEnsName={currentEnsName}
        onBegin={() => {
          if (phase.setup.txCount > 0) {
            onEnsSetup(phase.setup)
            return
          }
          onEnsLink(phase.setup.fullName, {
            mode: 'advanced',
            ownerAddress: phase.setup.ownerAddress,
          })
        }}
        onChange={pickParent}
        onBack={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.setup.rootName, label: phase.setup.label })}
      />
    )
  }

  if (phase.kind === 'advanced-manual') {
    return (
      <EnsSetupBlockedScreen
        fallback={phase.fallback}
        onCheckAgain={() => runAdvancedSubdomainCheck(phase.fallback.rootName, phase.fallback.label)}
        onChange={pickParent}
        onBack={() => setPhase({ kind: 'advanced-subdomain', rootName: phase.fallback.rootName, label: phase.fallback.label })}
      />
    )
  }

  return null
}
