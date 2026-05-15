import { config } from './state.js'
import type { WalletErrorPayload } from './types.js'
import { glyphs } from './html.js'
import {
  accountCopy,
  chainLabel,
  FLOW_COPY,
  isTransactionFlow,
  purposeCopy,
  signCopy,
  STATE_TITLES,
  shortAddr,
  transactionCopy,
  transactionPurposeTitle,
  type FlowCopy,
} from './copy.js'
import { walletErrorHtml } from './errorView.js'

let card: HTMLElement;
let promptText: HTMLElement;
let flowTitle: HTMLElement;
let networkRow: HTMLElement;
let flowDetail: HTMLElement;
let detailsBlock: HTMLElement;
let detailKey: HTMLElement;
let detailVal: HTMLElement;
let netVal: HTMLElement;
let statusBlock: HTMLElement;
let statusMarker: HTMLElement;
export let statusText: HTMLElement;
export let statusHint: HTMLElement;
export let errorSlot: HTMLElement;
export let approve: HTMLButtonElement;
export let cancel: HTMLButtonElement;

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("Wallet page missing #" + id);
  return element as T;
}

export function initializeViewElements(): void {
  card = requiredElement("card");
  promptText = requiredElement("prompt-text");
  flowTitle = requiredElement("flow-title");
  networkRow = requiredElement("network-row");
  flowDetail = requiredElement("flow-detail");
  detailsBlock = requiredElement("details-block");
  detailKey = requiredElement("detail-key");
  detailVal = requiredElement("detail-val");
  netVal = requiredElement("net-val");
  statusBlock = requiredElement("status-block");
  statusMarker = requiredElement("status-marker");
  statusText = requiredElement("status-text");
  statusHint = requiredElement("status-hint");
  errorSlot = requiredElement("error-block-slot");
  approve = requiredElement("approve");
  cancel = requiredElement("cancel");
}

let spinning = false;
function startSpinner(): void {
  spinning = true;
  statusMarker.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  statusMarker.style.background = "transparent";
}
function stopSpinner(): void {
  if (!spinning) return;
  spinning = false;
  statusMarker.innerHTML = "";
  statusMarker.style.background = "";
}
function setMarker(text: string): void { stopSpinner(); statusMarker.textContent = text; }
export function flowCopy(): FlowCopy { return FLOW_COPY[config.kind] || FLOW_COPY.sign!; }

export function tabTitleForState(state: string): string {
  if (state === "connecting") return STATE_TITLES.connecting;
  if (state === "approve-sign") return STATE_TITLES.approveSign;
  if (state === "preparing-transaction") return STATE_TITLES.preparingTransaction;
  if (state === "approve-transaction") return STATE_TITLES.approveTransaction;
  if (state === "error") return STATE_TITLES.error;
  if (state === "approve") {
    if (config.kind === "account") return accountCopy().text;
    if (config.kind === "sign") return STATE_TITLES.approveSign;
    return STATE_TITLES.approveTransaction;
  }
  if (state === "submitting") {
    if (config.kind === "account") return STATE_TITLES.connecting;
    if (config.kind === "sign") return "Verifying signature";
    return "Confirming transaction";
  }
  if (state === "done") {
    if (config.kind === "account") return "Wallet connected";
    if (config.kind === "sign") return "Message signed";
    return "Transaction submitted";
  }
  return flowCopy().tabTitle || STATE_TITLES.default;
}

export function setTabTitle(title?: string): void {
  const t = title || flowCopy().tabTitle || STATE_TITLES.default;
  document.title = t;
  const chromeTitle = document.getElementById("chrome-title");
  if (chromeTitle) chromeTitle.textContent = "ethagent · " + t;
}

function messagePreview(message?: string): string {
  const preview = String(message || "").split("\n")[0] ?? "";
  return preview.length > 64 ? preview.slice(0, 64) + glyphs.ellipsis : preview;
}
function detailPreview(copy: FlowCopy): string {
  if (copy.detail === "message") return messagePreview(config.message);
  if (copy.detail === "registry" && config.tx) return shortAddr(config.tx.to);
  return "";
}
export function showPreparedMessage(message: string): void {
  const copy = flowCopy();
  if (copy.detail !== "message") return;
  const preview = messagePreview(message);
  detailKey.textContent = copy.detail;
  detailVal.textContent = preview;
  flowDetail.hidden = preview.length === 0;
  detailsBlock.hidden = flowDetail.hidden;
}

export function applyFlowChrome(): void {
  const copy = flowCopy();
  card.dataset.flow = copy.accent;
  promptText.textContent = copy.label;
  flowTitle.textContent =
    config.kind === "account" && config.purpose
      ? purposeCopy().flowTitle
      : (config.kind === "sign" || config.kind === "sign-transaction") && config.purpose
        ? purposeCopy().flowTitle
        : config.kind === "transaction"
          ? transactionPurposeTitle()
          : copy.title;
  setTabTitle(copy.tabTitle);
  applyTransferTimeline();
  if (!copy.detail) {
    networkRow.hidden = true;
    flowDetail.hidden = true;
    detailsBlock.hidden = true;
  } else {
    networkRow.hidden = false;
    flowDetail.hidden = false;
    detailsBlock.hidden = false;
    netVal.textContent = chainLabel(config.chainIdHex);
    detailKey.textContent = copy.detail;
    detailVal.textContent = detailPreview(copy);
    flowDetail.hidden = detailVal.textContent.length === 0;
    if (flowDetail.hidden) detailsBlock.hidden = true;
  }
}

type LifecycleId =
  | "ens-clear"
  | "ens-link"
  | "ens-update"
  | "ens-register"
  | "custody-switch"
  | "public-profile-vault";

const LIFECYCLE_DEFINITIONS: Record<LifecycleId, { steps: string[] }> = {
  "ens-clear":    { steps: ["Clear Records on Mainnet", "Save Cleared Snapshot"] },
  "ens-link":     { steps: ["Create Subdomain", "Set Records", "Save Snapshot"] },
  "ens-update":   { steps: ["Update Records on Mainnet", "Save Updated Snapshot"] },
  "ens-register": { steps: ["Commit ENS Name", "Register ENS Name"] },
  "custody-switch": { steps: ["Deploy Vault", "Deposit Token", "Reconcile Operators"] },
  "public-profile-vault": { steps: ["Sign Profile", "Save Through Vault"] },
};

const FLOW_LIFECYCLE: Record<string, LifecycleId> = {
  "ens-clear":      "ens-clear",
  "ens-link":       "ens-link",
  "ens-update":     "ens-update",
  "ens-register":   "ens-register",
  "custody-switch": "custody-switch",
  "public-profile-vault": "public-profile-vault",
};

const PURPOSE_TIMELINE: Record<string, readonly [string, string]> = {
  "create-agent":                ["Sign Recovery Access", "Mint Token"],
  "update-snapshot-owner":       ["Sign Snapshot", "Save Onchain"],
  "update-snapshot-operator":    ["Sign Snapshot", "Save Onchain"],
  "update-snapshot-connected":   ["Sign Snapshot", "Save Onchain"],
  "update-profile-owner":        ["Sign Profile", "Save Onchain"],
  "update-profile-operator":     ["Sign Profile", "Save Onchain"],
  "update-profile-connected":    ["Sign Profile", "Save Onchain"],
  "update-operators":            ["Sign Operator List", "Publish List"],
  "create-simple-ens-subdomain": ["Sign Request", "Create Subdomain"],
  "set-simple-ens-records":      ["Sign Records", "Write Records"],
  "create-agent-ens-subdomain":  ["Sign Request", "Create Subdomain"],
  "set-agent-ens-records":       ["Sign Records", "Write Records"],
  "rotate-agent-uri-vault-owner":    ["Sign Update", "Save Through Vault"],
  "rotate-agent-uri-vault-operator": ["Sign Update", "Save Through Vault"],
  "update-ens":                  ["Sign Snapshot", "Save Onchain"],
  "clear-ens":                   ["Sign Snapshot", "Save Onchain"],
};

function activeLifecycle(): LifecycleId | undefined {
  if (config.flowId && FLOW_LIFECYCLE[config.flowId]) return FLOW_LIFECYCLE[config.flowId];
  return undefined;
}

let currentTimelineKey: string | null = null;

function lifecycleStepIndex(lifecycle: LifecycleId, state: string | null): number {
  const flowStep = typeof config.flowStep === "number" ? config.flowStep : 1;
  const def = LIFECYCLE_DEFINITIONS[lifecycle];
  const steps = def.steps.length;
  if (state === "done") return Math.min(flowStep, steps);
  return Math.max(0, Math.min(flowStep - 1, steps - 1));
}

function hasNextLifecyclePrompt(): boolean {
  const lifecycle = activeLifecycle();
  if (!lifecycle) return false;
  const flowStep = typeof config.flowStep === "number" ? config.flowStep : 1;
  return flowStep < LIFECYCLE_DEFINITIONS[lifecycle].steps.length;
}

function nextLifecycleHint(): string {
  return "Keep this page open. The next wallet step will appear here.";
}

function purposeStepIndex(state: string | null): number {
  if (state === "approve-transaction" || state === "submitting") return 1;
  if (state === "done") return 2;
  return 0;
}

export function applyTransferTimeline(): void {
  const timeline = document.getElementById("timeline") as HTMLElement | null;
  if (!timeline) return;

  const lifecycle = activeLifecycle();
  let steps: string[] | null = null;
  let activeIndex = 0;
  let key = "";

  if (lifecycle) {
    steps = LIFECYCLE_DEFINITIONS[lifecycle].steps;
    activeIndex = lifecycleStepIndex(lifecycle, currentState);
    key = "flow:" + lifecycle;
  } else if (config.kind === "sign-transaction") {
    const tuple = PURPOSE_TIMELINE[config.purpose || ""] || (["Sign", "Submit"] as const);
    steps = [tuple[0], tuple[1]];
    activeIndex = purposeStepIndex(currentState);
    key = "purpose:" + (config.purpose || "");
  }

  if (!steps) {
    if (!timeline.hidden) timeline.hidden = true;
    currentTimelineKey = null;
    return;
  }

  if (currentTimelineKey !== key) {
    timeline.innerHTML = "";
    for (const action of steps) {
      const li = document.createElement("li");
      li.className = "timeline-step";
      li.dataset.state = "pending";
      const marker = document.createElement("span");
      marker.className = "timeline-marker";
      marker.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "timeline-label";
      const actionEl = document.createElement("span");
      actionEl.className = "timeline-action";
      actionEl.textContent = action;
      label.append(actionEl);
      li.append(marker, label);
      timeline.append(li);
    }
    timeline.setAttribute("aria-label", "Wallet popup steps");
    currentTimelineKey = key;
  }

  timeline.hidden = false;
  const stepEls = timeline.querySelectorAll<HTMLElement>(".timeline-step");
  stepEls.forEach((step, i) => {
    const next = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
    if (step.dataset.state !== next) step.dataset.state = next;
  });
}

function markActiveTimelineStepDone(): void {
  const timeline = document.getElementById("timeline") as HTMLElement | null;
  if (!timeline || timeline.hidden) return;
  timeline.querySelectorAll<HTMLElement>('.timeline-step[data-state="active"]').forEach((step) => {
    step.dataset.state = "done";
  });
}

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
  setTimeout(apply, 220);
}

export let currentState: string | null = null;

export function setState(state: string, payload?: any): void {
  payload = payload || {};
  currentState = state;
  errorSlot.innerHTML = "";
  statusBlock.style.display = "flex";
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
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="20 6 9 17 4 12"></polyline></svg>';
      statusText.textContent =
        config.kind === "account" ? "Connected · Returning"
          : config.kind === "sign" ? (hasNextLifecyclePrompt() ? "Signed · Waiting" : "Signed · Returning")
            : "Submitted · Returning";
      statusHint.textContent = payload.txHash
        ? (isTransactionFlow() ? "Transaction submitted. Returning." : "This tab will close shortly.")
        : hasNextLifecyclePrompt() ? nextLifecycleHint() : "This tab will close shortly.";
      markActiveTimelineStepDone();
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
