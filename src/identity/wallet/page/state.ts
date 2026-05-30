function spinnerText(value: string): string {
  const text = preserveProtocolCaps(value);
  return text.replace(/^(\s*)([a-z])/, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}
function spinnerHintText(value: string): string { return preserveProtocolCaps(value); }
function preserveProtocolCaps(value: string): string {
  return String(value || "")
    .replace(/\bapi\b/gi, "API")
    .replace(/\bens\b/gi, "ENS")
    .replace(/\berc-8004\b/gi, "ERC-8004")
    .replace(/\bgguf\b/gi, "GGUF")
    .replace(/\bhugging face\b/gi, "Hugging Face")
    .replace(/\bipfs\b/gi, "IPFS")
    .replace(/\bjson\b/gi, "JSON")
    .replace(/\bjwt\b/gi, "JWT")
    .replace(/\bmemory\.md\b/gi, "MEMORY.md")
    .replace(/\bopenai\b/gi, "OpenAI")
    .replace(/\banthropic\b/gi, "Anthropic")
    .replace(/\bgemini\b/gi, "Gemini")
    .replace(/\bos\b/gi, "OS")
    .replace(/\brpc\b/gi, "RPC")
    .replace(/\bsoul\.md\b/gi, "SOUL.md")
    .replace(/\buri\b/gi, "URI")
    .replace(/\burl\b/gi, "URL");
}

function setStatus(marker: string, text: string, hint: string, spin: boolean): void {
  const lineEl = statusText.parentElement as HTMLElement;
  const hintEl = statusHint;
  const displayText = spin ? spinnerText(text) : text;
  const displayHint = spin ? spinnerHintText(hint) : hint;
  const apply = () => {
    if (spin) startSpinner();
    else setMarker(marker);
    statusText.textContent = displayText;
    hintEl.textContent = displayHint;
    requestAnimationFrame(() => {
      lineEl.classList.remove("is-changing");
      hintEl.classList.remove("is-changing");
    });
  };
  if (statusText.textContent === displayText && hintEl.textContent === displayHint) {
    if (spin) startSpinner();
    else setMarker(marker);
    return;
  }
  lineEl.classList.add("is-changing");
  hintEl.classList.add("is-changing");
  setTimeout(apply, 260);
}

export let currentState: string | null = null;

export function setState(state: string, payload?: any): void {
  payload = payload || {};
  currentState = state;
  errorSlot.innerHTML = "";
  statusBlock.style.display = "flex";
  statusBlock.dataset.tone = state === "done" ? "success" : state === "cancelled" ? "cancelled" : "pending";
  const terminal = state === "done" || state === "cancelled";
  const cardEl = document.getElementById("card");
  if (cardEl) cardEl.dataset.phase = terminal ? "terminal" : "active";
  setTabTitle(tabTitleForState(state));
  applyTransferTimeline();
  switch (state) {
    case "connecting":
      setStatus("·", "Connecting To Wallet...", "Open your wallet if needed.", true);
      break;
    case "approve":
      if (config.kind === "account") {
        const copy = accountCopy();
        setStatus("·", copy.text, copy.hint, true);
      } else if (config.kind === "sign") {
        const sigCopy = signCopy();
        setStatus("·", sigCopy.text, sigCopy.hint, true);
      } else {
        const txCopy = transactionCopy();
        setStatus("·", txCopy.text, txCopy.hint, true);
      }
      break;
    case "approve-sign":
      {
        const sigCopy = signCopy();
        setStatus("·", sigCopy.text, sigCopy.hint, true);
      }
      break;
    case "preparing-transaction":
      setStatus("·", purposeCopy().prepare!.text, purposeCopy().prepare!.hint, true);
      break;
    case "approve-transaction":
      {
        const txCopy = transactionCopy();
        setStatus("·", txCopy.text, txCopy.hint, true);
      }
      break;
    case "submitting":
      if (config.kind === "account") setStatus("·", "Connecting Wallet...", "Returning to terminal.", true);
      else if (config.kind === "sign") setStatus("·", "Verifying Signature...", hasNextLifecyclePrompt() ? nextLifecycleHint() : "Returning to terminal.", true);
      else setStatus("·", "Submitted · Waiting For Confirmation...", "Your wallet accepted the transaction.", true);
      break;
    case "done":
      stopSpinner();
      statusMarker.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="20 6 9 17 4 12"></polyline></svg>';
      statusText.textContent =
        config.kind === "account" ? "Connected"
          : config.kind === "sign" ? "Signed"
            : "Submitted";
      statusHint.textContent = payload.txHash
        ? (isTransactionFlow() ? "Transaction submitted. Returning." : "This tab will close shortly.")
        : hasNextLifecyclePrompt() ? nextLifecycleHint() : "This tab will close shortly.";
      markActiveTimelineStepDone();
      break;
    case "cancelled":
      stopSpinner();
      statusMarker.innerHTML = "";
      break;
    case "error":
      stopSpinner();
      statusBlock.style.display = "none";
      renderError(payload);
      break;
  }
}

let lastWalletError: WalletErrorPayload | null = null;

function renderError(payload: WalletErrorPayload): void {
  errorSlot.innerHTML = walletErrorHtml(payload);
  lastWalletError = payload;
}

export function getLastWalletError(): WalletErrorPayload | null { return lastWalletError }
export function clearLastWalletError(): void { lastWalletError = null }
