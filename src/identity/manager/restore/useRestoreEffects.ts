import { useEffect } from 'react'
import type { EthagentConfig } from '../../../storage/config.js'
import { runRestoreAuthorize } from './apply.js'
import { runRestoreConnectWallet } from './auth.js'
import { runRestoreDiscover } from './discover.js'
import { runRestoreFetch } from './fetch.js'
import { scopeCallbacks, type EffectCallbacks } from '../shared/effects/types.js'
import type { Step } from '../reducer.js'
import { waitForMinimumBusyTime } from '../shared/utils.js'

type RestoreFlowEffectsArgs = {
  step: Step
  config: EthagentConfig | undefined
  callbacks: EffectCallbacks
  handleStepError: (err: unknown, backStep: Step, softCancel?: Step, retry?: Step) => void
}

export function useRestoreEffects(args: RestoreFlowEffectsArgs): void {
  const { step, config, callbacks, handleStepError } = args

  useEffect(() => {
    if (step.kind !== 'restore-discovering') return
    let cancelled = false
    const startedAt = Date.now()
    const abortController = new AbortController()
    const stepWithSignal = { ...step, abortSignal: abortController.signal }
    runRestoreDiscover(stepWithSignal, config, callbacks)
      .catch(async (err: unknown) => {
        await waitForMinimumBusyTime(startedAt)
        if (cancelled) return
        handleStepError(err, { kind: 'restore-network', ownerHandle: step.ownerHandle, purpose: step.purpose })
      })
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-wallet') return
    let cancelled = false
    const scope = scopeCallbacks(callbacks)
    runRestoreConnectWallet(step, scope.callbacks)
      .catch((err: unknown) => { if (!cancelled) handleStepError(err, { kind: 'menu' }) })
    return () => {
      cancelled = true
      scope.cancel()
    }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-fetching') return
    let cancelled = false
    const scope = scopeCallbacks(callbacks)
    const startedAt = Date.now()
    const backStep: Step = { kind: 'restore-network', ownerHandle: step.requesterAddress ?? step.candidate.ownerAddress, purpose: step.purpose }
    runRestoreFetch(step, scope.callbacks)
      .catch(async (err: unknown) => {
        await waitForMinimumBusyTime(startedAt)
        if (!cancelled) handleStepError(err, backStep, backStep, step)
      })
    return () => {
      cancelled = true
      scope.cancel()
    }
  }, [step])

  useEffect(() => {
    if (step.kind !== 'restore-authorizing') return
    let cancelled = false
    const scope = scopeCallbacks(callbacks)
    runRestoreAuthorize(step, scope.callbacks)
      .catch((err: unknown) => {
        if (!cancelled) handleStepError(err, { kind: 'restore-network', ownerHandle: step.requesterAddress ?? step.candidate.ownerAddress, purpose: step.purpose })
      })
    return () => {
      cancelled = true
      scope.cancel()
    }
  }, [step])
}
