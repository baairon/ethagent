import type { EthagentConfig, EthagentIdentity } from "../src/storage/config.js";
import type { AgentReconciliation } from "../src/identity/manager/shared/reconciliation/agentReconciliation/types.js";
import type { SkillsTreeView } from "../src/identity/continuity/skills/loadSkills.js";
import type { SkillIndexEntry } from "../src/identity/continuity/skills/types.js";

const OWNER = "0xA1E977e700bF82019beb381F1582575303A389CE";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export const previewIdentity: EthagentIdentity = {
  address: OWNER,
  createdAt: "2026-04-25T22:06:31.000Z",
  source: "erc8004",
  ownerAddress: OWNER,
  chainId: 8453,
  identityRegistryAddress: REGISTRY,
  agentId: "45744",
  state: {
    name: "agent.bairon.eth",
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

export const previewConfig: EthagentConfig = {
  version: 2,
  firstSeenAt: "2026-04-25T22:00:00.000Z",
  identity: previewIdentity,
  erc8004: {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    identityRegistryAddress: REGISTRY,
  },
  selectedNetwork: "base",
};

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

export const previewSkillsTree: SkillsTreeView = {
  skills: [
    skill("browser", "public", "Open a link in the default browser."),
    skill("canvas", "public", "Track assignments and due dates locally."),
    skill("dotfiles-setup", "public", "Provision terminal and editor config on a new machine."),
    skill("media-downloader", "public", "Download media from a URL in the right format."),
    skill("os-keychain", "public", "OS-native encrypted secret store for every skill."),
    skill("outlook-email", "public", "Read, search, draft, and send email."),
    skill("totp-vault", "public", "Your 2FA codes, owned by you."),
  ],
  supportingCounts: {
    "browser": 1,
    "canvas": 4,
    "dotfiles-setup": 1,
    "media-downloader": 1,
    "os-keychain": 5,
    "outlook-email": 1,
    "totp-vault": 8,
  },
};
