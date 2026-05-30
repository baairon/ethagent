export const CARD_HTML = `
<main data-flow="sign" id="card">
  <div class="chrome">
    <span class="chrome-spacer"></span>
    <span class="chrome-title" id="chrome-title"></span>
    <span class="chrome-actions"></span>
  </div>
  <div class="body">
    <div class="card-header">
      <div class="card-logo">${LOGO_SVG}</div>
      <h2 class="flow-title" id="flow-title">Sign Message</h2>
    </div>
    <div class="timeline" id="timeline" hidden>
      <div class="timeline-head">
        <span class="timeline-now" id="timeline-now"></span>
        <span class="timeline-count" id="timeline-count"></span>
      </div>
      <div class="timeline-track" id="timeline-track"></div>
    </div>
    <div class="details" id="details-block">
      <p class="flow-detail" id="flow-detail">
        <span class="key" id="detail-key">message</span>
        <span id="detail-val"></span>
      </p>
    </div>
    <div class="status" id="status-block">
      <p class="status-line">
        <span class="marker" id="status-marker"></span>
        <span id="status-text">Connecting to your wallet…</span>
      </p>
      <p class="status-hint" id="status-hint">Open your wallet extension if it doesn't pop up automatically.</p>
      <p class="status-hint" id="reconnect-hint" hidden>Reconnecting to terminal…</p>
    </div>
    <div id="error-block-slot"></div>
  </div>
  <div class="footer">
    <div class="actions">
      <button id="cancel" class="shortcut"><span class="key">esc</span><span>cancel</span></button>
      <button id="approve" class="shortcut primary" hidden>
        <span class="key">enter</span><span>retry</span>
      </button>
    </div>
  </div>
</main>
`;

export function injectStylesAndMarkup(): void {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap";
  document.head.appendChild(link);
  const style = document.createElement("style");
  style.id = "wallet-styles";
  style.textContent = WALLET_CSS;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML("afterbegin", CARD_HTML);
}
