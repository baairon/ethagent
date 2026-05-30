let closeCountdown: ReturnType<typeof setInterval> | null = null
let handlersAttached = false

async function post(path: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(body || {}), sessionToken: config.sessionToken }),
  });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error(d.error || "Wallet request failed.");
  return d;
}

function showCloseCountdown(delayMs: number): void {
  if (closeCountdown) clearInterval(closeCountdown);
  const deadline = Date.now() + delayMs;
  const update = () => {
    const seconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    statusHint.textContent = "Return to your terminal. Closing in " + seconds + "s.";
  };
  update();
  closeCountdown = setInterval(update, 250);
}

let __sessionMode = false;
function closeSoon(delayMs?: number): void {
  if (__sessionMode) {
    if (closeCountdown) clearInterval(closeCountdown);
    statusHint.textContent = "Waiting for next request from terminal...";
    return;
  }
  const ms = delayMs == null ? CLOSE_DELAY_MS : delayMs;
  showCloseCountdown(ms);
  setTimeout(() => {
    if (closeCountdown) clearInterval(closeCountdown);
    try { if (window.opener && !window.opener.closed) window.opener.focus(); } catch (_) { }
    window.close();
    window.open("", "_self");
    window.close();
  }, ms);
}

async function ensureWallet(): Promise<string> {
  setState("connecting");
  const provider = await waitForEthereumProvider();
  setActiveEthereum(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = accounts && accounts[0];
  if (!account) throw new Error("No wallet account was selected.");
  if (config.expectedAccount && account.toLowerCase() !== String(config.expectedAccount).toLowerCase()) {
    throw new Error(
      "Switch to " + shortAddr(config.expectedAccount) + " in your wallet, then press Enter to retry."
    );
  }
  if (!config.chainIdHex) return account;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: config.chainIdHex }] });
  } catch (err) {
    const cur = await provider.request({ method: "eth_chainId" });
    if (String(cur).toLowerCase() !== String(config.chainIdHex).toLowerCase()) throw err;
  }
  return account;
}

export async function runWalletFlow(): Promise<void> {
  approve.disabled = true;
  approve.hidden = true;
  cancel.disabled = false;
  errorSlot.innerHTML = "";
  clearLastWalletError();
  try {
    const account = await ensureWallet();
    if (config.kind === "account") {
      setState("submitting");
      await post("/complete", { account });
      setState("done");
      closeSoon();
      return;
    }
    if (config.kind === "sign") {
      const prepared = config.message ? { message: config.message } : await post("/prepare", { account });
      showPreparedMessage(prepared.message);
      setState("approve");
      const signature = await walletRequest("personal_sign", [prepared.message, account]);
      setState("submitting");
      await post("/complete", { account, message: prepared.message, signature });
      setState("done");
      closeSoon();
      return;
    }
    if (config.kind === "sign-transaction") {
      const prepared = config.message ? { message: config.message } : await post("/prepare", { account });
      showPreparedMessage(prepared.message);
      setState("approve-sign", { account });
      const signature = await walletRequest("personal_sign", [prepared.message, account]);
      setState("preparing-transaction", { account });
      const txPayload = await post("/prepare-transaction", { account, message: prepared.message, signature });
      setState("approve-transaction", { account, tx: txPayload.tx });
      const tx = txPayload.tx || {};
      const txHash = await walletRequest("eth_sendTransaction", [buildTxParams(account, tx)]);
      setState("submitting", { account, tx, txHash });
      await post("/complete", { account, txHash });
      setState("done", { account, tx, txHash });
      closeSoon(TX_CLOSE_DELAY_MS);
      return;
    }
    if (config.kind === "transaction") {
      setState("approve", { account, tx: config.tx });
      const txHash = await walletRequest("eth_sendTransaction", [buildTxParams(account, config.tx as WalletTx)]);
      setState("submitting", { account, tx: config.tx, txHash });
      await post("/complete", { account, txHash });
      setState("done", { account, tx: config.tx, txHash });
      closeSoon(TX_CLOSE_DELAY_MS);
      return;
    }
    throw new Error("Unknown wallet request type.");
  } catch (err) {
    approve.disabled = false;
    approve.hidden = false;
    cancel.disabled = false;
    const serialized = serializeWalletError(err, currentWalletMethod);
    clearCurrentWalletMethod();
    setState("error", serialized as Record<string, unknown>);
  }
}

export async function cancelFlow(): Promise<void> {
  approve.disabled = true;
  cancel.disabled = true;
  const lastWalletError = getLastWalletError();
  if (lastWalletError) {
    await post("/error", lastWalletError as Record<string, unknown>).catch(() => { });
  } else {
    await post("/cancel", {}).catch(() => { });
  }
  setState("cancelled");
  statusText.textContent = lastWalletError ? "Aborted · returning" : "Cancelled · returning";
  closeSoon(CANCEL_CLOSE_DELAY_MS);
}

function escapeAllowed(): boolean {
  return currentState !== "submitting" && currentState !== "done" && currentState !== "cancelled";
}

export function startSessionMode(): void {
  __sessionMode = true;
  setState("connecting");
  statusText.textContent = "Waiting for terminal...";
  const reconnectHint = document.getElementById("reconnect-hint") as HTMLElement | null;
  const showReconnecting = (visible: boolean) => {
    if (!reconnectHint) return;
    reconnectHint.hidden = !visible;
  };
  const events = new EventSource("/events");
  const clearReconnect = () => showReconnecting(false);
  events.addEventListener("prompt", (ev: MessageEvent) => {
    clearReconnect();
    try {
      const next = JSON.parse(ev.data);
      for (const k of Object.keys(config)) delete (config as any)[k];
      Object.assign(config, next);
      applyFlowChrome();
      setTimeout(runWalletFlow, 50);
    } catch (err) {
      setState("error", { message: (err && (err as Error).message) || String(err) });
    }
  });
  events.addEventListener("done", () => {
    clearReconnect();
    events.close();
    __sessionMode = false;
    setState("done");
    statusText.textContent = "All set · Returning";
    closeSoon();
  });
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) {
      clearReconnect();
      return;
    }
    showReconnecting(true);
  };
}
