function attachWalletHandlers(): void {
  if (handlersAttached) return
  handlersAttached = true
  approve.onclick = runWalletFlow
  cancel.onclick = cancelFlow
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!escapeAllowed()) { e.preventDefault(); return }
      e.preventDefault()
      cancelFlow()
    } else if (e.key === 'Enter') {
      if (!approve.hidden && !approve.disabled) { e.preventDefault(); runWalletFlow(); return }
    }
  })
}

export function bootWallet(): void {
  initializeViewElements()
  attachWalletHandlers()
  applyFlowChrome()
  setupCardResize()
  if (!window.__WALLET_PREVIEW__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootWallet, { once: true })
    } else {
      if (config && config.kind === 'session-wait') {
        startSessionMode()
      } else {
        runWalletFlow()
      }
    }
  } else {
    window.__walletPreview = {
      setState,
      setConfig: (c: Partial<WalletConfig>) => { Object.assign(config, c); applyFlowChrome() },
    }
    runWalletFlow()
  }
}

injectStylesAndMarkup()

bootWallet()
