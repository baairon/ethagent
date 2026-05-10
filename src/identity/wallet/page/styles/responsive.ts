export const RESPONSIVE_CSS = String.raw`
  padding-bottom: 0;
  margin-top: -14px;
  border-color: transparent;
  box-shadow: none;
  pointer-events: none;
}

#error-block-slot {
  padding: 16px 18px;
  background: #080a10;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.5),
              0 1px 0 rgba(255, 255, 255, 0.03) inset;
  max-height: 400px;
  opacity: 1;
  margin-top: 0;
  overflow: hidden;
  transition: max-height 480ms var(--ease-standard),
              padding 480ms var(--ease-standard),
              margin 480ms var(--ease-standard),
              opacity 480ms var(--ease-standard),
              border-color 320ms var(--ease-standard),
              box-shadow 320ms var(--ease-standard);
}

.error-title {
  color: var(--c-gray-900);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: capitalize;
  margin: 0 0 8px;
}

.error-msg {
  color: var(--c-gray-900);
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 10px;
  line-height: 1.5;
}

.error-action {
  color: var(--c-gray-700);
  font-size: 11.5px;
  margin: 0 0 6px;
  line-height: 1.5;
  font-style: italic;
}

.error-cause {
  color: var(--c-gray-600);
  font-size: 11.5px;
  margin: 0 0 4px 8px;
  line-height: 1.5;
  border-left: 2px solid rgba(255, 255, 255, 0.10);
  padding-left: 8px;
}

.error-hint {
  color: var(--c-gray-500);
  font-size: 11.5px;
  margin: 8px 0 0;
  line-height: 1.5;
}

.error-hint a {
  color: var(--c-text-accent);
  text-decoration: none;
  font-weight: 600;
  border-bottom: 1px dashed color-mix(in srgb, var(--c-text-accent) 50%, transparent);
  padding-bottom: 1px;
  transition: all 0.2s ease;
}

.error-hint a:hover { color: var(--c-text-accent); border-bottom-style: solid; }

.error-hint code {
  font-family: var(--font-mono);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  color: var(--c-gray-700);
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 5px;
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.10) inset,
              0 1px 2px rgba(0, 0, 0, 0.25);
  letter-spacing: 0.02em;
}


.footer {
  flex: none;
  padding: 15px 22px 17px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.net-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-ui);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--c-gray-800);
  padding: 5px 13px 5px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3),
              0 1px 0 rgba(255, 255, 255, 0.08) inset;
}

.net-pill .dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #d8dcfa;
  border: 1px solid #a3a3c2;
}

.net-pill[hidden] { display: none; }

.actions { display: inline-flex; align-items: center; gap: 10px; }

.shortcut {
  font: inherit;
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 5px 10px;
  cursor: pointer;
  color: var(--c-gray-700);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 7px;
  transition: all 0.15s var(--ease-standard);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3),
              0 1px 0 rgba(255, 255, 255, 0.04) inset;
}

.shortcut:focus { outline: none; }
.shortcut:focus-visible { outline: 2px solid var(--c-blue-400); outline-offset: 2px; }

.shortcut:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.10);
  color: var(--c-gray-900);
  transform: translateY(-0.5px);
}

.shortcut:active:not(:disabled) { transform: translateY(0); }
.shortcut:disabled { opacity: 0.4; cursor: not-allowed; }
.shortcut[hidden] { display: none; }

#cancel.shortcut {
  background: #020407;
  border-color: rgba(255, 255, 255, 0.08);
  color: #b0b0b0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3),
              0 1px 0 rgba(255, 255, 255, 0.04) inset;
}

#cancel.shortcut:hover:not(:disabled) {
  background: #070a0f;
  color: #f1f1f1;
}

.shortcut.primary {
  background: #020407;
  border-color: #020407;
  color: #fff;
  box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.5),
              0 1px 0 rgba(255, 255, 255, 0.1) inset;
}

.shortcut.primary:hover:not(:disabled) { background: #070a0f; color: #fff; }

.shortcut.primary .key {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--c-gray-500);
  background: rgba(255, 255, 255, 0.10);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.10) inset,
              0 1px 2px rgba(0, 0, 0, 0.25);
  border-radius: 5px;
  letter-spacing: 0.02em;
}

.shortcut .pix { color: currentColor; opacity: 0.85; display: inline-flex; }

.head .net { display: none; }

@media (max-width: 560px), (max-height: 680px) {
  body { padding: 10px; }
  main { max-height: calc(100dvh - 20px); border-radius: 18px; }
  .chrome { padding: 9px 12px; }
  .body { padding: 12px 13px 14px; gap: 9px; }
  .splash-wrap { margin: 2px 0 0; padding: 2px 0; }
  .splash { font-size: 8px; }
  .flow-title { font-size: 16px; }
  .details, .status { padding: 10px 11px; border-radius: 12px; }
  .timeline { padding: 10px 6px 0; max-height: 76px; gap: 4px; }
  .timeline-step { gap: 9px; }
  .timeline-step + .timeline-step::before,
  .timeline-step + .timeline-step::after { top: 5px; }
  .flow-detail { grid-template-columns: 74px 1fr; gap: 8px; font-size: 12px; }
  .timeline-action { font-size: 11px; }
  .status-line { gap: 8px; font-size: 12px; }
  .status-line .marker { width: 12px; height: 12px; font-size: 11px; }
  .status-hint { margin-left: 20px; font-size: 11.5px; }
  .footer { padding: 10px 12px 12px; gap: 8px; }
  .actions { gap: 7px; }
  .shortcut { font-size: 11.5px; padding: 4px 8px; }
  .net-pill { font-size: 10px; padding: 4px 8px; }
}
`;
