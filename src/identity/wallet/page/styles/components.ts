export const COMPONENT_CSS = String.raw`
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin-top: -6px;
  overflow: hidden;
  pointer-events: none;
}

.timeline-step {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 2px;
}


.timeline-step + .timeline-step::before {
  content: "";
  position: absolute;
  top: 6px;
  right: calc(50% + 9px);
  left: calc(-50% + 9px);
  height: 1.5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.09);
}


.timeline-step + .timeline-step::after {
  content: "";
  position: absolute;
  top: 6px;
  right: calc(50% + 9px);
  left: calc(-50% + 9px);
  height: 1.5px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    color-mix(in srgb, #d8dcfa 70%, transparent),
    #d8dcfa
  );
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 620ms var(--ease-out);
}

.timeline-step[data-state="done"] + .timeline-step::after {
  transform: scaleX(1);
}


.timeline-marker {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
  background: #030509;
  border: 1.5px solid rgba(255, 255, 255, 0.22);
  box-sizing: border-box;
  transition: background 280ms var(--ease-standard),
              border-color 280ms var(--ease-standard),
              transform 280ms var(--ease-standard);
}

.timeline-step[data-state="active"] .timeline-marker {
  background: var(--accent);
  border-color: var(--accent);
  transform: scale(1.1);
}


.timeline-step[data-state="active"] .timeline-marker::after {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--accent) 38%, transparent);
  animation: timeline-ping 1.9s var(--ease-out) infinite;
  pointer-events: none;
}

@keyframes timeline-ping {
  0%   { opacity: 0.85; transform: scale(0.62); }
  70%  { opacity: 0;    transform: scale(1.35); }
  100% { opacity: 0;    transform: scale(1.35); }
}

.timeline-step[data-state="done"] .timeline-marker {
  background: #d8dcfa;
  border-color: #d8dcfa;
}

.timeline-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: 100%;
  text-align: center;
}

.timeline-action {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  color: rgba(241, 241, 241, 0.42);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  letter-spacing: 0;
  transition: color 320ms var(--ease-standard),
              font-weight 320ms var(--ease-standard),
              opacity 320ms var(--ease-standard);
}

.timeline-step[data-state="active"] .timeline-action {
  color: #ffffff;
  font-weight: 600;
}

.timeline-step[data-state="done"] .timeline-action {
  color: color-mix(in srgb, #d8dcfa 78%, rgba(241, 241, 241, 0.55));
  font-weight: 500;
}


.details {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  background: #080a10;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  box-shadow: 0 4px 16px -4px rgba(0, 0, 0, 0.45),
              0 1px 0 rgba(255, 255, 255, 0.03) inset;
  max-height: 210px;
  opacity: 1;
  margin-top: 0;
  overflow: hidden;
  transition: max-height 480ms var(--ease-standard),
              padding 480ms var(--ease-standard),
              margin 480ms var(--ease-standard),
              opacity 480ms var(--ease-standard),
              border-color 480ms var(--ease-standard),
              box-shadow 480ms var(--ease-standard);
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
  grid-template-columns: 96px 1fr;
  align-items: center;
  gap: 12px;
  font-size: 13.5px;
  color: var(--c-gray-700);
  margin: 0;
  line-height: 1.35;
}

.flow-detail[hidden] { display: none; }

.flow-detail .key {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--c-gray-500);
  text-transform: lowercase;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  justify-self: start;
  min-width: 0;
}

.flow-detail span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-gray-900);
  font-weight: 500;
}

.status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  background: #080a10;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  box-shadow: 0 4px 16px -4px rgba(0, 0, 0, 0.45),
              0 1px 0 rgba(255, 255, 255, 0.03) inset;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--c-gray-900);
  margin: 0;
}


.status-line .marker {
  font-family: var(--font-mono);
  font-size: 12px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  flex: none;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  backdrop-filter: blur(10px) saturate(140%);
  box-shadow: none;
}

.status-hint {
  font-size: 12.5px;
  color: var(--c-gray-500);
  margin: 0 0 0 24px;
  line-height: 1.4;
}

#error-block-slot:empty {
  display: block;
  max-height: 0;
  opacity: 0;
  padding-top: 0;
`;
