import React, { createContext, useContext, useEffect, useState } from 'react'
import { useStdout } from 'ink'

export const PANEL_WIDTH = 46
const PANEL_PADDING = 4
const FALLBACK_COLUMNS = 80

export function panelWidthFor(_columns?: number): number {
  return PANEL_WIDTH
}

export function contentWidthFor(columns?: number): number {
  return panelWidthFor(columns) - PANEL_PADDING
}

const ColumnsContext = createContext<number | null>(null)

export const TerminalSizeProvider: React.FC<{ columns?: number; children: React.ReactNode }> = ({ columns: fixed, children }) => {
  const outer = useContext(ColumnsContext)
  const { stdout } = useStdout()
  const [columns, setColumns] = useState(() => stdout?.columns || FALLBACK_COLUMNS)
  const tracking = !fixed && outer === null
  useEffect(() => {
    if (!stdout || !tracking) return
    const onResize = () => setColumns(stdout.columns || FALLBACK_COLUMNS)
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout, tracking])
  return <ColumnsContext.Provider value={fixed ?? outer ?? columns}>{children}</ColumnsContext.Provider>
}

export function useTerminalColumns(): number {
  const provided = useContext(ColumnsContext)
  const { stdout } = useStdout()
  return provided ?? (stdout?.columns || FALLBACK_COLUMNS)
}

export function usePanelWidth(): number {
  return panelWidthFor(useTerminalColumns())
}

export function useContentWidth(): number {
  return contentWidthFor(useTerminalColumns())
}
