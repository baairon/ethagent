import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useStdin, useStdout } from 'ink'
import type { AppInputEvent } from './appInputParser.js'
import {
  BRACKETED_PASTE_DISABLE,
  BRACKETED_PASTE_ENABLE,
  createAppInputParseState,
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  hasPendingAppInput,
  parseAppInput,
} from './appInputParser.js'

type InputHandler = (input: string, key: AppInputEvent['key'], event: AppInputEvent) => void

type HandlerEntry = {
  handlerRef: React.MutableRefObject<InputHandler>
  isActiveRef: React.MutableRefObject<boolean>
}

type AppInputContextValue = {
  register(entry: HandlerEntry): () => void
}

const AppInputContext = createContext<AppInputContextValue | null>(null)
const PENDING_ESCAPE_FLUSH_MS = 50

export const AppInputProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const handlersRef = useRef<Set<HandlerEntry>>(new Set())
  const parseStateRef = useRef(createAppInputParseState())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dispatch = useCallback((event: AppInputEvent) => {
    for (const entry of handlersRef.current) {
      if (!entry.isActiveRef.current) continue
      entry.handlerRef.current(event.input, event.key, event)
    }
  }, [])

  const flushPending = useCallback(() => {
    flushTimerRef.current = null
    const result = parseAppInput(parseStateRef.current, null)
    parseStateRef.current = result.state
    for (const event of result.events) dispatch(event)
  }, [dispatch])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(flushPending, PENDING_ESCAPE_FLUSH_MS)
  }, [flushPending])

  useEffect(() => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return

    const handleData = (chunk: Buffer | string) => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      const result = parseAppInput(parseStateRef.current, chunk)
      parseStateRef.current = result.state
      for (const event of result.events) dispatch(event)
      if (hasPendingAppInput(parseStateRef.current)) scheduleFlush()
    }

    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    stdin.ref()
    stdin.on('data', handleData)
    stdin.resume()
    stdout.write(BRACKETED_PASTE_ENABLE)
    stdout.write(ENABLE_KITTY_KEYBOARD)
    stdout.write(ENABLE_MODIFY_OTHER_KEYS)

    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      stdout.write(DISABLE_MODIFY_OTHER_KEYS)
      stdout.write(DISABLE_KITTY_KEYBOARD)
      stdout.write(BRACKETED_PASTE_DISABLE)
      stdin.off('data', handleData)
      stdin.setRawMode(false)
      stdin.pause()
      stdin.unref()
    }
  }, [dispatch, scheduleFlush, stdin, stdout])

  const value = useMemo<AppInputContextValue>(() => ({
    register(entry) {
      handlersRef.current.add(entry)
      return () => {
        handlersRef.current.delete(entry)
      }
    },
  }), [])

  return <AppInputContext.Provider value={value}>{children}</AppInputContext.Provider>
}

export function useAppInput(
  handler: InputHandler,
  options: { isActive?: boolean } = {},
): void {
  const ctx = useContext(AppInputContext)
  if (!ctx) throw new Error('useAppInput must be used inside AppInputProvider')

  const handlerRef = useRef(handler)
  const isActiveRef = useRef(options.isActive !== false)

  useEffect(() => { handlerRef.current = handler }, [handler])
  useEffect(() => { isActiveRef.current = options.isActive !== false }, [options.isActive])
  useEffect(() => ctx.register({ handlerRef, isActiveRef }), [ctx])
}
