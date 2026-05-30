export function serializeWalletError(err: unknown, method: string | null): WalletErrorPayload {
  const e = err as any
  const message = ((e && (e.message ?? String(err))) || 'Something went wrong.').trim()
  const codeRaw = e && (e.code ?? e.errorCode)
  const code = codeRaw === undefined || codeRaw === null ? undefined : String(codeRaw)
  const data = safeStringify(e && e.data, 500)
  const causes: string[] = []
  let cur = e && e.cause
  for (let i = 0; i < 5 && cur; i++) {
    const cm = ((cur && (cur.message ?? String(cur))) || '').trim()
    if (cm) causes.push(cm)
    cur = cur && cur.cause
  }
  const out: WalletErrorPayload = { message }
  if (code) out.code = code
  if (data) out.data = data
  if (causes.length) out.causes = causes
  if (method) out.method = method
  if (config.purpose) out.purpose = config.purpose
  if (config.chainIdHex) out.chainIdHex = config.chainIdHex
  return out
}

export function walletErrorHtml(payload: WalletErrorPayload): string {
  const msg = payload.message || 'Something went wrong.'
  const isNoWallet = /no wallet|window\.ethereum|metamask|rabby|brave|extension/i.test(msg)
  const isUserReject = /user rejected|user denied|cancelled|canceled/i.test(msg)
  const isWrongChain = /chain|network/i.test(msg) && !isNoWallet
  const isExecutionRevert = /execution reverted|revert/i.test(msg)
  const isOwnerWalletRequired = /owner wallet required/i.test(msg)
  const isOperatorWalletRequired = /operator wallet required/i.test(msg)
  let title = 'Wallet Error'
  let body = msg
  let hint = ''
  const codeClass = classifyByCode(payload.code)
  if (codeClass) {
    title = codeClass.title
    hint = codeClass.hint
  } else if (isOwnerWalletRequired) {
    title = 'Owner Wallet Required'
    body = msg.replace(/^owner wallet required:\s*/i, '')
    body = body ? body.charAt(0).toUpperCase() + body.slice(1) : 'Switch to the owner wallet.'
    hint = 'Switch to the owner wallet, then retry.'
  } else if (isOperatorWalletRequired) {
    title = 'Operator Wallet Required'
    body = msg.replace(/^operator wallet required:\s*/i, '')
    body = body ? body.charAt(0).toUpperCase() + body.slice(1) : 'Switch to the operator wallet.'
    hint = 'Switch to the operator wallet, then retry.'
  } else if (isNoWallet) {
    title = 'No Wallet'
    body = 'Install a wallet.'
    hint = 'Install a wallet, then retry.'
  } else if (isUserReject) {
    title = 'Rejected'
    body = 'Request declined in wallet.'
    hint = ''
  } else if (isWrongChain) {
    title = 'Wrong Network'
    hint = `Switch to <code>${escapeHtml(chainLabel(config.chainIdHex))}</code>, then retry.`
  } else if (isExecutionRevert) {
    title = 'Transaction Reverted'
    hint = 'Use the expected wallet and check ENS ownership, then retry.'
  }
  if (body) body = body.charAt(0).toUpperCase() + body.slice(1)
  payload.title = title
  const action = actionContextFor(payload)
  let html = `<p class="error-title">${escapeHtml(title)}</p>`
    + `<p class="error-msg">${escapeHtml(body)}</p>`
  if (action) html += `<p class="error-action">${escapeHtml(action)}</p>`
  if (payload.causes && payload.causes.length) {
    for (const cause of payload.causes) {
      html += `<p class="error-cause">Caused by: ${escapeHtml(cause)}</p>`
    }
  }
  if (hint) html += `<p class="error-hint">${hint}</p>`
  return html
}

function safeStringify(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  let s: string
  try { s = typeof v === 'string' ? v : JSON.stringify(v) } catch (_) { s = String(v) }
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) + '...' : s
}

function actionContextFor(payload: WalletErrorPayload): string {
  const purpose = payload.purpose || config.purpose
  if (purpose) {
    const copy = (PURPOSE_COPY as any)[purpose] as PurposeCopyEntry | undefined
    const ctx = copy && (copy as any).errorContext
    if (typeof ctx === 'string' && ctx) return ctx
  }
  if (payload.method) return `during ${payload.method}`
  return ''
}

function classifyByCode(code: string | undefined): { title: string; hint: string } | null {
  if (!code) return null
  switch (code) {
    case '4001': return { title: 'Rejected', hint: '' }
    case '4100': return { title: 'Wallet Not Authorized', hint: 'Connect this site in your wallet, then retry.' }
    case '4200': return { title: 'Method Not Supported by Wallet', hint: 'Use a wallet that supports this transaction type, then retry.' }
    case '4900': return { title: 'Wallet Disconnected', hint: 'Reconnect your wallet, then retry.' }
    case '4901': return { title: 'Wrong Network', hint: `Switch to <code>${escapeHtml(chainLabel(config.chainIdHex))}</code>, then retry.` }
    case '-32603': return { title: 'Internal Wallet RPC Error', hint: "The wallet's connected RPC failed. Try again, or switch RPC in your wallet settings." }
    case '-32602': return { title: 'Invalid Request Parameters', hint: '' }
    case '-32000': case '-32001': case '-32002': case '-32003': case '-32004':
    case '-32005': case '-32006': case '-32007': case '-32008': case '-32009':
      return { title: 'Wallet RPC Error', hint: 'The wallet RPC reported a server error. Try again or switch RPC in your wallet.' }
    default: return null
  }
}
