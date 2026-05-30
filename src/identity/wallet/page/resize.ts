// Smoothly animates the card's height whenever its content changes, so the
// surface glides between states instead of snapping. The animation is the
// native Web Animations API, with no external library, so it stays lightweight
// and runs the same on every machine. It falls back to an instant resize when
// the API is unavailable or the user prefers reduced motion.

let cardEl: HTMLElement | null = null;
let cardInnerEl: HTMLElement | null = null;
let resizeAnim: Animation | null = null;
let trackedHeight = 0;
let measuredOnce = false;
let cardResizeReady = false;

// Snappy ease-out (mirrors --ease-out in css.ts): quick to start, gentle to settle.
const RESIZE_DURATION_MS = 200;
const RESIZE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {
    return false;
  }
}

function cardHeightCap(): number {
  const compact = window.matchMedia("(max-width: 560px), (max-height: 680px)").matches;
  const margin = compact ? 20 : 32;
  return Math.max(160, window.innerHeight - margin);
}

function naturalHeight(): number {
  if (!cardInnerEl) return 0;
  return Math.min(cardInnerEl.offsetHeight, cardHeightCap());
}

function applyHeight(px: number): void {
  if (cardEl) cardEl.style.height = Math.round(px) + "px";
}

function settleToContent(): void {
  if (!cardEl || !cardInnerEl) return;
  const target = naturalHeight();
  if (!measuredOnce) {
    measuredOnce = true;
    trackedHeight = target;
    applyHeight(target);
    return;
  }
  if (Math.abs(target - trackedHeight) < 1) return;
  const from = cardEl.getBoundingClientRect().height || trackedHeight;
  trackedHeight = target;
  animateHeight(from, target);
}

function animateHeight(from: number, to: number): void {
  const el = cardEl;
  if (!el) return;
  if (resizeAnim) {
    try { resizeAnim.cancel(); } catch (_) { /* noop */ }
    resizeAnim = null;
  }
  // The rounded inline height is the source of truth: set it first so the card
  // rests at the final size once the animation ends (default fill is none).
  applyHeight(to);
  if (typeof el.animate !== "function" || prefersReducedMotion() || Math.abs(to - from) < 1) return;
  const anim = el.animate(
    [{ height: Math.round(from) + "px" }, { height: Math.round(to) + "px" }],
    { duration: RESIZE_DURATION_MS, easing: RESIZE_EASING }
  );
  resizeAnim = anim;
  const clear = (): void => { if (resizeAnim === anim) resizeAnim = null; };
  anim.onfinish = clear;
  anim.oncancel = clear;
}

export function setupCardResize(): void {
  if (cardResizeReady) return;
  cardEl = document.getElementById("card");
  cardInnerEl = document.getElementById("card-inner");
  if (!cardEl || !cardInnerEl || typeof ResizeObserver === "undefined") return;
  cardResizeReady = true;
  settleToContent();
  let scheduled = false;
  const observer = new ResizeObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      settleToContent();
    });
  });
  observer.observe(cardInnerEl);
  window.addEventListener("resize", () => settleToContent());
}
