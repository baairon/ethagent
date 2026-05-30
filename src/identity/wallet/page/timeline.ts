type LifecycleId =
  | "ens-clear"
  | "ens-link"
  | "ens-update"
  | "ens-register"
  | "custody-switch"
  | "public-profile-vault";

const LIFECYCLE_DEFINITIONS: Record<LifecycleId, { steps: string[] }> = {
  "ens-clear":    { steps: ["Clear Records on Mainnet", "Save Cleared Snapshot"] },
  "ens-link":     { steps: ["Create Subdomain", "Set Records", "Save Snapshot"] },
  "ens-update":   { steps: ["Update Records on Mainnet", "Save Updated Snapshot"] },
  "ens-register": { steps: ["Commit ENS Name", "Register ENS Name"] },
  "custody-switch": { steps: ["Deploy Vault", "Deposit Token", "Reconcile Operators"] },
  "public-profile-vault": { steps: ["Sign Profile", "Save Through Vault"] },
};

const FLOW_LIFECYCLE: Record<string, LifecycleId> = {
  "ens-clear":      "ens-clear",
  "ens-link":       "ens-link",
  "ens-update":     "ens-update",
  "ens-register":   "ens-register",
  "custody-switch": "custody-switch",
  "public-profile-vault": "public-profile-vault",
};

const PURPOSE_TIMELINE: Record<string, readonly [string, string]> = {
  "create-agent":                ["Sign Recovery Access", "Mint Token"],
  "update-snapshot-owner":       ["Sign Snapshot", "Save Onchain"],
  "update-snapshot-operator":    ["Sign Snapshot", "Save Onchain"],
  "update-snapshot-connected":   ["Sign Snapshot", "Save Onchain"],
  "update-profile-owner":        ["Sign Profile", "Save Onchain"],
  "update-profile-operator":     ["Sign Profile", "Save Onchain"],
  "update-profile-connected":    ["Sign Profile", "Save Onchain"],
  "update-operators":            ["Sign Operator List", "Publish List"],
  "create-simple-ens-subdomain": ["Sign Request", "Create Subdomain"],
  "set-simple-ens-records":      ["Sign Records", "Write Records"],
  "create-agent-ens-subdomain":  ["Sign Request", "Create Subdomain"],
  "set-agent-ens-records":       ["Sign Records", "Write Records"],
  "rotate-agent-uri-vault-owner":    ["Sign", "Save"],
  "rotate-agent-uri-vault-operator": ["Sign", "Save"],
  "update-ens":                  ["Sign Snapshot", "Save Onchain"],
  "clear-ens":                   ["Sign Snapshot", "Save Onchain"],
};

function activeLifecycle(): LifecycleId | undefined {
  if (config.flowId && FLOW_LIFECYCLE[config.flowId]) return FLOW_LIFECYCLE[config.flowId];
  return undefined;
}

let currentTimelineKey: string | null = null;

function lifecycleStepIndex(lifecycle: LifecycleId, state: string | null): number {
  const flowStep = typeof config.flowStep === "number" ? config.flowStep : 1;
  const def = LIFECYCLE_DEFINITIONS[lifecycle];
  const steps = def.steps.length;
  if (state === "done") return Math.min(flowStep, steps);
  return Math.max(0, Math.min(flowStep - 1, steps - 1));
}

function hasNextLifecyclePrompt(): boolean {
  const lifecycle = activeLifecycle();
  if (!lifecycle) return false;
  const flowStep = typeof config.flowStep === "number" ? config.flowStep : 1;
  return flowStep < LIFECYCLE_DEFINITIONS[lifecycle].steps.length;
}

function nextLifecycleHint(): string {
  return "Keep this page open. The next wallet step will appear here.";
}

function purposeStepIndex(state: string | null): number {
  if (state === "approve-transaction" || state === "submitting") return 1;
  if (state === "done") return 2;
  return 0;
}

export function applyTransferTimeline(): void {
  const timeline = document.getElementById("timeline") as HTMLElement | null;
  if (!timeline) return;

  if (currentState === "error" || currentState === "cancelled") {
    hideTimeline(timeline);
    return;
  }

  const lifecycle = activeLifecycle();
  let steps: string[] | null = null;
  let activeIndex = 0;
  let key = "";

  if (lifecycle) {
    steps = LIFECYCLE_DEFINITIONS[lifecycle].steps;
    activeIndex = lifecycleStepIndex(lifecycle, currentState);
    key = "flow:" + lifecycle;
  } else if (config.kind === "sign-transaction") {
    const tuple = PURPOSE_TIMELINE[config.purpose || ""] || (["Sign", "Submit"] as const);
    steps = [tuple[0], tuple[1]];
    activeIndex = purposeStepIndex(currentState);
    key = "purpose:" + (config.purpose || "");
  }

  if (!steps) {
    hideTimeline(timeline);
    return;
  }

  currentTimelineKey = key;
  timeline.hidden = false;

  const total = steps.length;
  const currentIndex = Math.min(activeIndex, total - 1);
  const stepNumber = Math.min(activeIndex + 1, total);

  const now = document.getElementById("timeline-now");
  if (now) now.textContent = steps[currentIndex] ?? "";
  const count = document.getElementById("timeline-count");
  if (count) count.textContent = pad(stepNumber) + " / " + pad(total);
  renderTimelineSegments(total, activeIndex);
}

function hideTimeline(timeline: HTMLElement): void {
  if (!timeline.hidden) timeline.hidden = true;
  currentTimelineKey = null;
  const track = document.getElementById("timeline-track");
  if (track) track.innerHTML = "";
}

function renderTimelineSegments(total: number, activeIndex: number): void {
  const track = document.getElementById("timeline-track");
  if (!track) return;
  if (track.childElementCount !== total) {
    track.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const seg = document.createElement("span");
      seg.className = "timeline-seg";
      track.appendChild(seg);
    }
  }
  const isDone = currentState === "done";
  const children = track.children;
  for (let i = 0; i < children.length; i++) {
    const seg = children[i] as HTMLElement;
    const done = i < activeIndex;
    const active = i === activeIndex && !isDone;
    seg.className = "timeline-seg" + (done ? " is-done" : active ? " is-active" : "");
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function markActiveTimelineStepDone(): void {
  const track = document.getElementById("timeline-track");
  if (!track) return;
  const segs = track.querySelectorAll(".timeline-seg.is-active");
  for (let i = 0; i < segs.length; i++) {
    (segs[i] as HTMLElement).className = "timeline-seg is-done";
  }
}
