export const BASE_CSS = String.raw`
*,
*::before,
*::after { box-sizing: border-box; }

:root {
  interpolate-size: allow-keywords;
  --font-ui: Inter, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
               "DejaVu Sans Mono", "Liberation Mono", monospace;
  --font-display: Inter, "SF Pro Display", "Segoe UI", system-ui, sans-serif;

  --c-gray-900: #1f2330;
  --c-gray-800: #2f364a;
  --c-gray-700: #49526a;
  --c-gray-500: #6f7890;
  --c-gray-400: #949bb0;
  --c-blue-400: #5f8fff;
  --c-blue-500: #3f76ff;
  --c-blue-700: #2954c6;
  --c-danger: #e5484d;
  --c-success: #1aa86b;

  --mint-accent: #ededfd;
  --mint-accent-strong: #d8dcfa;
  --mint-accent-soft: rgba(237, 237, 253, 0.20);
  --mint-glow: rgba(237, 237, 253, 0.32);
  --c-text-accent: #9eaae0;

  --ease-standard: cubic-bezier(0.2, 0.0, 0, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --fg-1: #1f2330;
}

html, body { height: 100%; margin: 0; overflow: hidden; }

body {
  position: relative;
  font-family: var(--font-ui);
  color: var(--fg-1);
  background: #120f17;
  display: grid;
  place-items: center;
  padding: clamp(18px, 3vw, 28px);
}


.grainient-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
}

main {
  position: relative;
  z-index: 1;
  width: min(700px, 100%);
  max-height: calc(100dvh - 36px);
  display: flex;
  flex-direction: column;
  background: #030509;
  color: #f1f1f1;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 26px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 -1px 0 rgba(0, 0, 0, 0.6) inset,
    0 30px 80px -20px rgba(0, 0, 0, 0.75),
    0 12px 28px -8px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  height: fit-content;

  --c-gray-900: #f1f1f1;
  --c-gray-800: #d8d8d8;
  --c-gray-700: #b0b0b0;
  --c-gray-500: #8a8a8a;
  --c-gray-400: #6f6f6f;
}


.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 12px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  flex: none;
}

.chrome-spacer { flex: 1 1 0; min-width: 0; }

.chrome-title {
  flex: 0 1 auto;
  text-align: center;
  font-size: 11.5px;
  color: rgba(241, 241, 241, 0.55);
  font-weight: 500;
  letter-spacing: 0.01em;
  margin: 0;
}

.chrome-actions {
  flex: 1 1 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}


.body {
  flex: 1;
  min-height: 0;
  padding: clamp(20px, 3vw, 28px) clamp(22px, 4vw, 32px) clamp(22px, 3vw, 30px);
  display: flex;
  flex-direction: column;
  gap: 15px;
  overflow: hidden;
}

.splash-wrap {
  flex: none;
  display: flex;
  justify-content: center;
  margin: 6px 0 2px;
  padding: 4px 0;
}

.splash {
  font-family: var(--font-mono);
  font-size: clamp(9.5px, 1.35vw, 11px);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: 0;
  white-space: pre;
  margin: 0;
  text-align: left;
  transform: scaleX(0.8);
  transform-origin: 50% 50%;
  color: rgba(255, 255, 255, 0.7);
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

[data-flow] {
  --accent: var(--mint-accent);
  --accent-soft: var(--mint-accent-soft);
  --glow: var(--mint-glow);
}

main, .head .label, .status, .status-line, .status-hint, .flow-detail,
#error-block-slot, .net-pill {
  transition: height 480ms var(--ease-standard),
              background-color 320ms var(--ease-standard),
              border-color 320ms var(--ease-standard),
              color 320ms var(--ease-standard),
              box-shadow 320ms var(--ease-standard);
}

.status-line, .status-hint {
  transition: opacity 280ms var(--ease-standard),
              transform 280ms var(--ease-standard),
              color 320ms var(--ease-standard);
}

.status-line.is-changing, .status-hint.is-changing {
  opacity: 0;
  transform: translateY(-3px);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.head .label {
  font-family: var(--font-ui);
  color: var(--c-gray-800);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: capitalize;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 13px 5px 10px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3),
              0 1px 0 rgba(255, 255, 255, 0.08) inset;
}

.head .label::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #d8dcfa;
  border: 1px solid #a3a3c2;
}

.flow-title {
  font-family: var(--font-display);
  font-size: clamp(18px, 2.6vw, 20px);
  font-weight: 600;
  line-height: 1.22;
  letter-spacing: 0;
  margin: 0;
  color: var(--c-gray-900);
  text-wrap: balance;
}


.timeline {
  list-style: none;
  margin: 0;
  padding: 14px 10px 4px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  max-height: 96px;
  opacity: 1;
  overflow: visible;
  position: relative;
  transition: max-height 480ms var(--ease-standard),
              padding 480ms var(--ease-standard),
              margin 480ms var(--ease-standard),
              opacity 480ms var(--ease-standard);
}

.timeline[hidden] {
  display: flex;
  max-height: 0;
`;
