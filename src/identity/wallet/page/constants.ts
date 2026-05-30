export const glyphs = {
  ellipsis: "…",
};

export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export const CLOSE_DELAY_MS = 10000
export const TX_CLOSE_DELAY_MS = 10000
export const CANCEL_CLOSE_DELAY_MS = 10000
export const WALLET_PROVIDER_WAIT_MS = 3000
export const WALLET_PROVIDER_POLL_MS = 100
