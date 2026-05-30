export const CARD_HTML = `
<main data-flow="sign" id="card">
  <div class="card-inner" id="card-inner">
    <div class="chrome">
      <span class="chrome-brand"></span>
      <span class="chrome-title" id="chrome-title"></span>
      <span class="chrome-actions"></span>
    </div>
    <div class="body">
      <div class="card-header">
        <h2 class="flow-title" id="flow-title">Sign Message</h2>
        <p class="flow-subtitle" id="flow-subtitle"></p>
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
  </div>
</main>
`;

export function injectStylesAndMarkup(): void {
  const font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap";
  document.head.appendChild(font);

  const style = document.createElement("style");
  style.id = "wallet-styles";
  style.textContent = WALLET_CSS;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML("afterbegin", CARD_HTML);
}
