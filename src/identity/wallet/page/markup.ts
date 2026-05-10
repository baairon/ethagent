import { WALLET_CSS } from './styles/index.js'

export const CARD_HTML = `
<canvas id="grainient" class="grainient-canvas" aria-hidden="true"></canvas>
<main data-flow="sign" id="card">
  <div class="chrome">
    <span class="chrome-spacer"></span>
    <span class="chrome-title" id="chrome-title">ethagent</span>
    <span class="chrome-actions"></span>
  </div>
  <div class="body">
    <div class="splash-wrap"><pre class="splash" id="splash"></pre></div>
    <div class="head"><span class="label" id="prompt-text">signature request</span></div>
    <h2 class="flow-title" id="flow-title">Sign Message</h2>
    <ol class="timeline" id="timeline" hidden aria-label="Wallet flow steps"></ol>
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
    <span class="net-pill" id="network-row"><span class="dot"></span><span id="net-val">Sepolia</span></span>
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
  const style = document.createElement("style");
  style.id = "wallet-styles";
  style.textContent = WALLET_CSS;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML("afterbegin", CARD_HTML);
}
