export const WALLET_CSS = String.raw`
*,
*::before,
*::after { box-sizing: border-box; }

:root {
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo,
               Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace;
  --font-ui: var(--font-mono);
  --font-display: var(--font-mono);

  --bg: #000000;
  --surface: #000000;
  --panel: #0a0a0c;
  --raise: #131316;

  --line: #1d1d21;
  --line-soft: #161619;
  --line-strong: #2a2a30;

  --rim: rgba(255, 255, 255, 0.04);
  --rim-strong: rgba(255, 255, 255, 0.06);

  --radius: 0;
  --radius-sm: 0;
  --radius-xs: 0;

  --fg: #eef0f6;
  --fg-2: #b7bbc5;
  --fg-3: #82868f;
  --fg-4: #585c65;
  --fg-5: #3d4047;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

html, body { height: 100%; margin: 0; overflow: hidden; }

body {
  position: relative;
  font-family: var(--font-ui);
  color: var(--fg);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(18px, 3vw, 28px);
}

main {
  position: relative;
  z-index: 1;
  width: min(380px, 100%);
  max-height: calc(100dvh - 36px);
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow:
    0 24px 64px -24px rgba(0, 0, 0, 0.8);
  animation: card-in 540ms var(--ease-out) both;
  will-change: height;
}

.card-inner {
  display: flex;
  flex-direction: column;
}

@keyframes card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.984); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes block-in {
  from { opacity: 0; transform: translateY(5px); }
  to   { opacity: 1; transform: translateY(0); }
}

main, .flow-title, .flow-subtitle, .status, .status-line, .status-hint, .flow-detail,
#error-block-slot, .details {
  transition: background-color 300ms var(--ease-standard),
              border-color 300ms var(--ease-standard),
              box-shadow 320ms var(--ease-standard),
              color 300ms var(--ease-standard);
}

.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 12px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  flex: none;
}

.chrome-brand {
  flex: 1 1 0;
  min-width: 0;
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--fg-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chrome-title {
  flex: 0 1 auto;
  text-align: center;
  font-family: var(--font-ui);
  font-size: 10.5px;
  color: var(--fg-4);
  font-weight: 400;
  letter-spacing: 0.01em;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chrome-actions { flex: 1 1 0; display: flex; justify-content: flex-end; align-items: center; }

.body {
  flex: 1;
  min-height: 0;
  padding: clamp(18px, 2.5vw, 24px) clamp(20px, 3vw, 26px) clamp(20px, 2.5vw, 26px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}

.card-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
}

.flow-title {
  font-family: var(--font-display);
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--fg);
  text-wrap: balance;
  text-align: left;
}

.flow-subtitle {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: -0.005em;
  margin: 0;
  color: var(--fg-3);
  text-align: left;
  text-wrap: pretty;
}

.flow-subtitle[hidden] { display: none; }

.timeline {
  margin: 0;
  padding: 1px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
  animation: block-in 380ms var(--ease-out) both;
}

.timeline[hidden] { display: none; }

.timeline-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.timeline-now {
  min-width: 0;
  font-family: var(--font-ui);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 280ms var(--ease-standard);
}

.timeline-count {
  flex: none;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.08em;
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}

.timeline-track {
  display: flex;
  align-items: stretch;
  gap: 5px;
  width: 100%;
}

.timeline-seg {
  flex: 1 1 0;
  min-width: 0;
  height: 3px;
  border-radius: 0;
  background: #1f1f24;
  transition: background-color 420ms var(--ease-standard),
              opacity 420ms var(--ease-standard);
}

.timeline-seg.is-done {
  background: #6b6f79;
}

.timeline-seg.is-active {
  background: #34363c;
  animation: seg-pulse 1.4s var(--ease-standard) infinite;
}

@keyframes seg-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.details {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  overflow: hidden;
  box-shadow: 0 4px 16px -4px rgba(0, 0, 0, 0.45),
              0 1px 0 var(--rim) inset;
  animation: block-in 380ms var(--ease-out) both;
}

.details[hidden] { display: none; }

.flow-detail {
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 12px;
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--fg-2);
  margin: 0;
  line-height: 1.35;
}

.flow-detail[hidden] { display: none; }

.flow-detail .key {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--fg-3);
  text-transform: lowercase;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  background: var(--raise);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  justify-self: start;
  align-self: center;
  min-width: 0;
}

.flow-detail span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-weight: 500;
}

.flow-detail[data-detail="message"] {
  display: block;
}

.flow-detail[data-detail="message"] .key {
  display: block;
  margin: 0 0 8px;
  padding: 0;
  background: none;
  border: 0;
  text-transform: lowercase;
  letter-spacing: 0.08em;
  color: var(--fg-3);
}

.flow-detail[data-detail="message"] span:last-child {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
  overflow: hidden;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
  color: var(--fg);
}

.status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px -4px rgba(0, 0, 0, 0.45),
              0 1px 0 var(--rim) inset;
}

.status-line, .status-hint {
  transition: opacity 260ms var(--ease-standard),
              transform 260ms var(--ease-standard),
              color 300ms var(--ease-standard);
}

.status-line.is-changing, .status-hint.is-changing {
  opacity: 0;
  transform: translateY(-3px);
}

.status-line {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.4;
  color: var(--fg);
  margin: 0;
}

.status-line .marker {
  font-family: var(--font-mono);
  font-size: 11px;
  width: 14px;
  height: 16.8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-4);
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: 1;
  transition: color 300ms var(--ease-standard);
}

.status[data-tone="success"] {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  padding: 4px 2px;
  gap: 8px;
}

.status[data-tone="cancelled"] .status-line,
.status[data-tone="success"] .status-line {
  align-items: center;
}

.status[data-tone="success"] .marker {
  width: 20px;
  height: 20px;
  border: 0;
  background: none;
  color: var(--fg);
}

.status[data-tone="cancelled"] .marker { display: none; }
.status[data-tone="cancelled"] .status-hint { margin-left: 0; }

.status[data-tone="success"] .status-hint {
  margin-left: 29px;
}

#card[data-phase="terminal"] .details,
#card[data-phase="terminal"] .footer { display: none; }

.spinner {
  display: inline-block;
  position: relative;
  top: 1px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1;
  color: var(--fg-3);
}

.status-hint {
  font-family: var(--font-ui);
  font-size: 10.5px;
  font-weight: 400;
  color: var(--fg-4);
  margin: 4px 0 0 23px;
  line-height: 1.55;
}

#error-block-slot:empty { display: none; }

#error-block-slot {
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  overflow: hidden;
  box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.5),
              0 1px 0 var(--rim) inset;
  animation: block-in 380ms var(--ease-out) both;
}

#error-block-slot > :last-child { margin-bottom: 0; }

.error-title {
  font-family: var(--font-ui);
  color: var(--fg);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.35;
  margin: 0 0 5px;
}

.error-msg {
  font-family: var(--font-ui);
  color: var(--fg-4);
  font-size: 10.5px;
  font-weight: 400;
  margin: 0 0 10px;
  line-height: 1.55;
}

.error-action {
  font-family: var(--font-ui);
  color: var(--fg-4);
  font-size: 11px;
  margin: 0 0 6px;
  line-height: 1.5;
}

.error-cause {
  font-family: var(--font-ui);
  color: var(--fg-4);
  font-size: 11px;
  margin: 0 0 4px 8px;
  line-height: 1.5;
  border-left: 1px solid var(--line-strong);
  padding-left: 8px;
}

.error-hint {
  font-family: var(--font-ui);
  color: var(--fg-3);
  font-size: 11px;
  margin: 8px 0 0;
  line-height: 1.5;
}

.error-hint a {
  color: var(--fg);
  text-decoration: none;
  font-weight: 600;
  border-bottom: 1px solid var(--line-strong);
  padding-bottom: 1px;
  transition: border-color 160ms var(--ease-out);
}

.error-hint a:hover { border-bottom-color: var(--fg-4); }

.error-hint code {
  font-family: var(--font-mono);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  color: var(--fg-2);
  background: var(--raise);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  letter-spacing: 0.02em;
}

.footer {
  flex: none;
  padding: 13px 18px 14px;
  border-top: 1px solid var(--line);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.actions { display: inline-flex; align-items: center; gap: 14px; }

.shortcut {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  background: none;
  border: 0;
  padding: 5px 4px;
  cursor: pointer;
  color: var(--fg-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: color 120ms var(--ease-out);
}

.shortcut:focus { outline: none; }
.shortcut:focus-visible { outline: 1px solid var(--fg-3); outline-offset: 2px; }

.shortcut:hover:not(:disabled) { color: var(--fg); }
.shortcut:active:not(:disabled) { color: var(--fg-2); }
.shortcut:hover:not(:disabled) .key {
  color: var(--fg);
  border-color: var(--line-strong);
  background: var(--raise);
}
.shortcut:active:not(:disabled) .key { transform: translateY(0.5px); }

.shortcut:disabled { color: var(--fg-5); cursor: not-allowed; }
.shortcut:disabled .key { color: var(--fg-5); border-color: var(--line); }
.shortcut[hidden] { display: none; }

.shortcut.primary { color: var(--fg); font-weight: 600; }
.shortcut.primary:hover:not(:disabled) { color: var(--fg); }
.shortcut.primary:hover:not(:disabled) .key { color: var(--fg); border-color: #3a3a42; background: var(--raise); }
.shortcut.primary:disabled { color: var(--fg-4); }
.shortcut.primary .key { color: var(--fg-2); border-color: var(--line-strong); }

.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--fg-3);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  letter-spacing: 0.02em;
  box-shadow: 0 1px 0 var(--rim) inset;
  transition: background-color 120ms var(--ease-out),
              border-color 120ms var(--ease-out),
              color 120ms var(--ease-out),
              transform 90ms var(--ease-out);
}

.shortcut .key {
  box-shadow: 0 1px 0 var(--rim) inset,
              0 1px 1.5px rgba(0, 0, 0, 0.45);
}

@media (max-width: 560px), (max-height: 680px) {
  body { padding: 10px; }
  main { max-height: calc(100dvh - 20px); border-radius: 0; }
  .chrome { padding: 9px 12px 9px 16px; }
  .body { padding: 12px 13px 14px; gap: 9px; }
  .flow-title { font-size: 13px; }
  .flow-subtitle { font-size: 10.5px; }
  .details, .status { padding: 10px 11px; border-radius: 0; }
  .flow-detail { grid-template-columns: max-content 1fr; gap: 8px; font-size: 11.5px; }
  .timeline-now { font-size: 11px; }
  .status-line { gap: 8px; font-size: 11px; }
  .status-hint { margin-left: 22px; font-size: 10.5px; }
  #error-block-slot { padding: 13px 14px; }
  .footer { padding: 11px 14px 12px; gap: 12px; }
  .actions { gap: 12px; }
  .shortcut { font-size: 11px; padding: 5px 4px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
