export const WALLET_CSS = String.raw`
*,
*::before,
*::after { box-sizing: border-box; }

:root {
  interpolate-size: allow-keywords;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
               "DejaVu Sans Mono", "Liberation Mono", monospace;

  --bg: #000000;
  --edge: 30px;
  --box-pad: 14px 16px;
  --tint: 220, 227, 242;
  --line: rgba(var(--tint), 0.07);
  --line-soft: rgba(var(--tint), 0.045);
  --line-strong: rgba(var(--tint), 0.14);
  --raise: rgba(var(--tint), 0.035);
  --inset-hi: inset 0 1px 0 rgba(var(--tint), 0.05);

  --fg: #f1f3f8;
  --fg-2: #bfc3cc;
  --fg-3: #888c96;
  --fg-4: #595d67;
  --fg-5: #40434b;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}

html, body { height: 100%; margin: 0; overflow: hidden; }

body {
  position: relative;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 3vw, 26px);
}

main {
  position: relative;
  z-index: 1;
  width: min(520px, 100%);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 0;
  box-shadow:
    var(--inset-hi),
    0 40px 120px -32px rgba(0, 0, 0, 0.9);
  overflow: hidden;
  height: fit-content;
}

main, .flow-title, .status, .status-line, .status-hint, .flow-detail,
#error-block-slot, .details {
  transition: height 460ms var(--ease-standard),
              background-color 300ms var(--ease-standard),
              border-color 300ms var(--ease-standard),
              color 300ms var(--ease-standard);
}

.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  background: transparent;
  flex: none;
}

.chrome-spacer { flex: 1 1 0; min-width: 0; }

.chrome-title {
  flex: 0 1 auto;
  text-align: center;
  font-size: 9.5px;
  color: var(--fg-3);
  font-weight: 500;
  letter-spacing: 0.08em;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chrome-actions { flex: 1 1 0; display: flex; justify-content: flex-end; align-items: center; }

.body {
  flex: 1;
  min-height: 0;
  padding: 26px var(--edge) 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.card-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
}

.card-logo {
  width: calc(100% + var(--edge) * 2);
  margin: -26px calc(var(--edge) * -1) 0;
  overflow: hidden;
  padding: 42px 24px 34px;
}

.card-logo svg { width: 100%; height: auto; display: block; }

.flow-title {
  font-family: var(--font-mono);
  font-size: clamp(12px, 1.4vw, 13.5px);
  font-weight: 600;
  line-height: 1.32;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--fg);
  text-wrap: balance;
  text-align: left;
}

.timeline {
  margin: 0;
  padding: 10px 0 2px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 64px;
  opacity: 1;
  overflow: hidden;
  transition: max-height 460ms var(--ease-standard),
              padding 460ms var(--ease-standard),
              margin 460ms var(--ease-standard),
              opacity 460ms var(--ease-standard);
}

.timeline[hidden] {
  display: flex;
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: -6px;
  pointer-events: none;
}

.timeline-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.timeline-now {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 280ms var(--ease-standard);
}

.timeline-count {
  flex: none;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
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
  background: rgba(var(--tint), 0.1);
  transition: background-color 420ms var(--ease-standard),
              opacity 420ms var(--ease-standard);
}

.timeline-seg.is-done {
  background: rgba(var(--tint), 0.62);
}

.timeline-seg.is-active {
  background: rgba(var(--tint), 0.3);
  animation: seg-pulse 1.4s var(--ease-standard) infinite;
}

@keyframes seg-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.details {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: var(--box-pad);
  background: var(--raise);
  border: 1px solid var(--line-soft);
  border-radius: 0;
  box-shadow: var(--inset-hi);
  max-height: 210px;
  opacity: 1;
  margin-top: 0;
  overflow: hidden;
  transition: max-height 460ms var(--ease-standard),
              padding 460ms var(--ease-standard),
              margin 460ms var(--ease-standard),
              opacity 460ms var(--ease-standard),
              border-color 460ms var(--ease-standard);
}

.details[hidden] {
  display: flex;
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: -14px;
  border-color: transparent;
  box-shadow: none;
  pointer-events: none;
}

.flow-detail {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 10px;
  font-size: 10px;
  color: var(--fg-2);
  margin: 0;
  line-height: 1.4;
}

.flow-detail[hidden] { display: none; }

.flow-detail .key {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  color: var(--fg-3);
  text-transform: lowercase;
  letter-spacing: 0.02em;
  padding: 2px 7px;
  background: var(--raise);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  justify-self: start;
  align-self: center;
  min-width: 0;
  transition: opacity 460ms var(--ease-standard);
}

.flow-detail span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-weight: 500;
}

.status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--box-pad);
  background: var(--raise);
  border: 1px solid var(--line-soft);
  border-radius: 0;
  box-shadow: var(--inset-hi);
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
  align-items: center;
  gap: 10px;
  font-size: 10px;
  font-weight: 500;
  color: var(--fg);
  margin: 0;
}

.status-line .marker {
  font-family: var(--font-mono);
  font-size: 12px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-3);
  flex: none;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

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
  font-size: 9px;
  color: var(--fg-3);
  margin: 0 0 0 26px;
  line-height: 1.45;
}

#error-block-slot:empty {
  display: block;
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: -14px;
  border-color: transparent;
  box-shadow: none;
  pointer-events: none;
}

#error-block-slot {
  padding: 14px 16px;
  background: var(--raise);
  border: 1px solid var(--line-soft);
  border-radius: 0;
  box-shadow: var(--inset-hi);
  max-height: 400px;
  opacity: 1;
  margin-top: 0;
  overflow: hidden;
  transition: max-height 460ms var(--ease-standard),
              padding 460ms var(--ease-standard),
              margin 460ms var(--ease-standard),
              opacity 460ms var(--ease-standard),
              border-color 300ms var(--ease-standard);
}

.error-title {
  color: var(--fg);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: capitalize;
  margin: 0 0 8px;
}

.error-msg {
  color: var(--fg);
  font-size: 10px;
  font-weight: 500;
  margin: 0 0 10px;
  line-height: 1.5;
}

.error-action {
  color: var(--fg-3);
  font-size: 9px;
  margin: 0 0 6px;
  line-height: 1.5;
  font-style: italic;
}

.error-cause {
  color: var(--fg-3);
  font-size: 9px;
  margin: 0 0 4px 8px;
  line-height: 1.5;
  border-left: 1px solid var(--line-strong);
  padding-left: 8px;
}

.error-hint {
  color: var(--fg-3);
  font-size: 9px;
  margin: 8px 0 0;
  line-height: 1.5;
}

.error-hint a {
  color: var(--fg);
  text-decoration: none;
  font-weight: 600;
  border-bottom: 1px solid rgba(var(--tint),0.3);
  padding-bottom: 1px;
  transition: border-color 160ms var(--ease-out);
}

.error-hint a:hover { border-bottom-color: rgba(var(--tint),0.7); }

.error-hint code {
  font-family: var(--font-mono);
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  color: var(--fg-2);
  background: var(--raise);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  letter-spacing: 0.01em;
}

.footer {
  flex: none;
  padding: 17px var(--edge) 19px;
  border-top: 1px solid var(--line);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.actions { display: inline-flex; align-items: center; gap: 10px; }

.shortcut {
  font: inherit;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.01em;
  background: var(--raise);
  border: 1px solid var(--line);
  padding: 5px 10px;
  cursor: pointer;
  color: var(--fg-3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 0;
  transition: background-color 120ms var(--ease-out),
              border-color 120ms var(--ease-out),
              color 120ms var(--ease-out),
              transform 90ms var(--ease-out);
}

.shortcut:focus { outline: none; }
.shortcut:focus-visible { outline: 1px solid rgba(var(--tint),0.55); outline-offset: 2px; }

.shortcut:hover:not(:disabled) {
  transform: translateY(-0.5px);
  border-color: rgba(var(--tint),0.5);
  color: var(--fg-2);
}
.shortcut:active:not(:disabled) { transform: translateY(0.5px); }
.shortcut:hover:not(:disabled) .key { color: var(--fg-2); border-color: rgba(var(--tint),0.35); }

.shortcut:disabled { opacity: 1; background: transparent; border-color: var(--line); color: var(--fg-5); cursor: not-allowed; }
.shortcut[hidden] { display: none; }

.shortcut.primary {
  background: rgba(var(--tint),0.065);
  border-color: var(--line-strong);
  color: var(--fg);
}

.shortcut.primary:hover:not(:disabled) {
  border-color: rgba(var(--tint),0.55);
  color: var(--fg);
}

.shortcut.primary:hover:not(:disabled) .key { color: var(--fg); border-color: rgba(var(--tint),0.45); }

.shortcut.primary:disabled { opacity: 1; background: var(--raise); border-color: var(--line); color: var(--fg-4); }

.shortcut.primary .key { color: var(--fg-2); border-color: var(--line-strong); }

.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 5px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  color: var(--fg-4);
  background: var(--raise);
  border: 1px solid var(--line);
  border-radius: 0;
  letter-spacing: 0.01em;
  transition: background-color 120ms var(--ease-out),
              border-color 120ms var(--ease-out),
              color 120ms var(--ease-out);
}

@media (max-width: 560px), (max-height: 680px) {
  body { padding: 10px; }
  main { max-height: calc(100dvh - 20px); --edge: 18px; }
  .chrome { padding: 9px 14px; }
  .body { padding: 16px 18px 18px; gap: 13px; }
  .flow-title { font-size: 12px; text-align: left; }
  .details, .status { padding: 10px 12px; }
  .timeline { padding: 8px 0 2px; }
  .timeline-now { font-size: 10px; }
  .timeline-count { font-size: 8.5px; }
  .status-line { gap: 9px; font-size: 10.5px; }
  .status-line .marker { width: 15px; height: 15px; font-size: 11px; }
  .status-hint { margin-left: 24px; font-size: 9.5px; }
  .footer { padding: 11px 16px 13px; gap: 8px; }
  .actions { gap: 7px; }
  .shortcut { font-size: 10px; padding: 4px 8px; }
  .card-logo { margin: -16px -18px 0; padding: 30px 16px 24px; }
  .card-logo svg { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;
