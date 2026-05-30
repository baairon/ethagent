let card: HTMLElement;
let flowTitle: HTMLElement;
let flowDetail: HTMLElement;
let detailsBlock: HTMLElement;
let detailKey: HTMLElement;
let detailVal: HTMLElement;
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
  flowTitle = requiredElement("flow-title");
  flowDetail = requiredElement("flow-detail");
  detailsBlock = requiredElement("details-block");
  detailKey = requiredElement("detail-key");
  detailVal = requiredElement("detail-val");
  statusBlock = requiredElement("status-block");
  statusMarker = requiredElement("status-marker");
  statusText = requiredElement("status-text");
  statusHint = requiredElement("status-hint");
  errorSlot = requiredElement("error-block-slot");
  approve = requiredElement("approve");
  cancel = requiredElement("cancel");
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
let spinning = false;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerIndex = 0;
function startSpinner(): void {
  spinning = true;
  spinnerIndex = 0;
  statusMarker.innerHTML = '<span class="spinner" aria-hidden="true">' + SPINNER_FRAMES[0] + '</span>';
  const glyph = statusMarker.firstElementChild as HTMLElement | null;
  if (spinnerTimer) clearInterval(spinnerTimer);
  spinnerTimer = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
    if (glyph) glyph.textContent = SPINNER_FRAMES[spinnerIndex]!;
  }, SPINNER_INTERVAL_MS);
}
function stopSpinner(): void {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
  if (!spinning) return;
  spinning = false;
  statusMarker.innerHTML = "";
}
function setMarker(text: string): void { stopSpinner(); statusMarker.textContent = text; }
export function flowCopy(): FlowCopy { return FLOW_COPY[config.kind] || FLOW_COPY.sign!; }

export function tabTitleForState(state: string): string {
  if (state === "connecting") return STATE_TITLES.connecting;
  if (state === "approve-sign") return STATE_TITLES.approveSign;
  if (state === "preparing-transaction") return STATE_TITLES.preparingTransaction;
  if (state === "approve-transaction") return STATE_TITLES.approveTransaction;
  if (state === "error") return STATE_TITLES.error;
  if (state === "cancelled") return STATE_TITLES.cancelled;
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
  if (chromeTitle) chromeTitle.textContent = t;
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
    flowDetail.hidden = true;
    detailsBlock.hidden = true;
  } else {
    flowDetail.hidden = false;
    detailsBlock.hidden = false;
    detailKey.textContent = copy.detail;
    detailVal.textContent = detailPreview(copy);
    flowDetail.hidden = detailVal.textContent.length === 0;
    if (flowDetail.hidden) detailsBlock.hidden = true;
  }
}
