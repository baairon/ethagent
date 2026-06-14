// Layout-only placeholder identity for the preview SVGs. No secrets: a public
// owner address, a token id, and benign profile strings, just enough to drive
// the menu status line and the Soul & Memory summary. Nothing here is read by
// the app at runtime; it only feeds scripts/render-previews-impl.tsx.
import type { EthagentConfig, EthagentIdentity } from "../src/storage/config.js";
import type { AgentReconciliation } from "../src/identity/manager/shared/reconciliation/agentReconciliation/types.js";
import type { SkillsTreeView } from "../src/identity/continuity/skills/loadSkills.js";
import type { SkillIndexEntry } from "../src/identity/continuity/skills/types.js";

const OWNER = "0xA1E977e700bF82019beb381F1582575303A389CE";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export const fakeIdentity: EthagentIdentity = {
  address: OWNER,
  createdAt: "2026-04-25T22:06:31.000Z",
  source: "erc8004",
  ownerAddress: OWNER,
  chainId: 8453,
  identityRegistryAddress: REGISTRY,
  agentId: "45744",
  state: {
    name: "bairon.eth",
    custodyMode: "simple",
    ensName: "agent.bairon.eth",
    ensValidation: { ok: true },
  },
  backup: {
    cid: "bafybeibwyrztma2dbfczw7q6ooozbxlqzyw5r7w4f3qw2axvvxqg3w6y7q",
    createdAt: "2026-06-13T19:40:00.000Z",
    envelopeVersion: "1",
    ipfsApiUrl: "https://api.pinata.cloud",
    status: "pinned",
  },
  agentCard: { cid: "bafybeih4card7q6ooozbxlqzyw5r7w4f3qw2axvvxqg3w6cardq", status: "pinned" },
};

export const fakeConfig: EthagentConfig = {
  version: 2,
  firstSeenAt: "2026-04-25T22:00:00.000Z",
  identity: fakeIdentity,
  erc8004: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    identityRegistryAddress: REGISTRY,
  },
  selectedNetwork: "base",
};

/** An all-clean reconciliation: nothing disabled, no banner, no asterisks. */
export const cleanReconciliation: AgentReconciliation = {
  token: "linked",
  custody: "simple",
  agentUri: "in-sync",
  vault: "unset",
  workingTree: "clean",
  rpc: "reachable",
  driftCount: 0,
  lastCheckedAt: "2026-06-14T16:00:00.000Z",
};

function skill(name: string, visibility: "public" | "private", description: string): SkillIndexEntry {
  return {
    name,
    description,
    visibility,
    relativePath: `${name}/SKILL.md`,
    absolutePath: `/skills/${name}/SKILL.md`,
  };
}

/** A sample skills catalog for the Skills preview. The screen renders each
 *  entry's name, visibility, and supporting-file count. */
export const fakeSkillsTree: SkillsTreeView = {
  skills: [
    skill("web-search", "public", "Search the web and pull back answers with sources."),
    skill("coding", "private", "Write, edit, and review code across a project."),
    skill("email", "private", "Read, draft, and send email."),
    skill("calendar", "public", "Check your schedule and book events."),
    skill("summarize", "public", "Condense long documents and threads into the gist."),
  ],
  supportingCounts: { "coding": 2, "email": 1, "summarize": 4 },
};
