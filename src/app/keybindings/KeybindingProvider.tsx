import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Key } from 'ink'
import { useAppInput } from '../input/AppInputProvider.js'
import type { Action, Binding, KeybindingContextName } from './types.js'
import { resolveKey } from './resolver.js'

type HandlerEntry = {
  handler: () => void
  context: KeybindingContextName
  isActive: boolean
}

type KeybindingContextValue = {
  register(action: Action, entry: HandlerEntry): () => void
  activateContext(ctx: KeybindingContextName): () => void
}

const Ctx = createContext<KeybindingContextValue | null>(null)

type ProviderProps = {
  bindings?: Binding[]
  children: React.ReactNode
}

const DEFAULT_BINDINGS: Binding[] = [
  { context: 'Global', chord: { key: 'c', ctrl: true }, action: 'app:interrupt' },
  { context: 'Global', chord: { key: 'l', ctrl: true }, action: 'app:redraw' },
  { context: 'Chat', chord: { key: 'escape' }, action: 'chat:cancel' },
  { context: 'Chat', chord: { key: 'p', meta: true }, action: 'chat:modelPicker' },
  { context: 'Chat', chord: { key: 'i', meta: true }, action: 'chat:identityHub' },
  { context: 'Chat', chord: { key: 't', meta: true }, action: 'chat:toggleReasoning' },
  { context: 'Chat', chord: { key: 'tab', shift: true }, action: 'chat:cycleMode' },
]

export const KeybindingProvider: React.FC<ProviderProps> = ({ bindings = DEFAULT_BINDINGS, children }) => {
  const registryRef = useRef<Map<Action, Set<HandlerEntry>>>(new Map())
  const [activeContexts, setActiveContexts] = useState<Set<KeybindingContextName>>(
    () => new Set<KeybindingContextName>(['Global']),
  )

  const register = useCallback((action: Action, entry: HandlerEntry) => {
    let bucket = registryRef.current.get(action)
    if (!bucket) {
      bucket = new Set()
      registryRef.current.set(action, bucket)
    }
    bucket.add(entry)
    return () => {
      const set = registryRef.current.get(action)
      if (!set) return
      set.delete(entry)
      if (set.size === 0) registryRef.current.delete(action)
    }
  }, [])

  const activateContext = useCallback((ctx: KeybindingContextName) => {
    setActiveContexts(prev => {
      if (prev.has(ctx)) return prev
      const next = new Set(prev)
      next.add(ctx)
      return next
    })
    return () => {
      setActiveContexts(prev => {
        if (!prev.has(ctx)) return prev
        const next = new Set(prev)
        next.delete(ctx)
        return next
      })
    }
  }, [])

  const value = useMemo<KeybindingContextValue>(() => ({ register, activateContext }), [register, activateContext])

  useAppInput((input, key) => {
    const action = resolveKey(input, key as Key, Array.from(activeContexts), bindings)
    if (!action) return
    const bucket = registryRef.current.get(action)
    if (!bucket || bucket.size === 0) return
    for (const entry of bucket) {
      if (!entry.isActive) continue
      if (!activeContexts.has(entry.context)) continue
      entry.handler()
      return
    }
  })

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useKeybindingContext(): KeybindingContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useKeybindingContext requires KeybindingProvider')
  return ctx
}

export function useOptionalKeybindingContext(): KeybindingContextValue | null {
  return useContext(Ctx)
}

type UseKeybindingOptions = {
  context?: KeybindingContextName
  isActive?: boolean
}

export function useKeybinding(
  action: Action,
  handler: () => void,
  options: UseKeybindingOptions = {},
): void {
  const ctx = useOptionalKeybindingContext()
  const context = options.context ?? 'Chat'
  const isActive = options.isActive ?? true
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler }, [handler])

  useEffect(() => {
    if (!ctx) return
    const entry: HandlerEntry = {
      handler: () => handlerRef.current(),
      context,
      isActive,
    }
    return ctx.register(action, entry)
  }, [ctx, action, context, isActive])
}

export function useRegisterKeybindingContext(context: KeybindingContextName, isActive = true): void {
  const ctx = useOptionalKeybindingContext()
  useEffect(() => {
    if (!ctx || !isActive) return
    return ctx.activateContext(context)
  }, [ctx, context, isActive])
}
