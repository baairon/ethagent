import { config } from './state.js'
import { glyphs } from './html.js'

export const CHAINS: Record<string, { name: string }> = {
  "0x1": { name: "Ethereum Mainnet" },
  "0xaa36a7": { name: "Sepolia" },
  "0x2105": { name: "Base" },
  "0x14a34": { name: "Base Sepolia" },
};

export interface FlowCopy {
  accent: string;
  tabTitle: string;
  label: string;
  title: string;
  detail: string | null;
}

export const FLOW_COPY: Record<string, FlowCopy> = {
  account:            { accent: "sign",        tabTitle: "Connect Wallet",   label: "Connection Request",   title: "Connect Wallet",   detail: null },
  sign:               { accent: "sign",        tabTitle: "Sign Message",     label: "Signature Request",    title: "Sign Message",     detail: "message" },
  "sign-transaction": { accent: "transaction", tabTitle: "Sign Snapshot",    label: "Snapshot Signature",   title: "Sign Snapshot",    detail: "message" },
  transaction:        { accent: "transaction", tabTitle: "Submit Transaction", label: "Onchain Transaction", title: "Submit Transaction", detail: "registry" },
};

export const TRANSACTION_TITLES: Record<string, string> = {
  "register-agent": "Mint Agent Token",
  "create-agent": "Create Agent",
  "update-ens-records": "Submit With ENS Controller Wallet",
  "clear-ens-records": "Submit With ENS Controller Wallet",
  "create-simple-ens-subdomain": "Submit With Connected Wallet",
  "set-simple-ens-records": "Submit With Connected Wallet",
  "create-agent-ens-subdomain": "Owner Wallet Required",
  "set-agent-ens-records": "Owner Wallet Required",
  "publish-transfer-snapshot": "Switch Back to Sender Wallet",
};

export function transactionPurposeTitle(): string {
  const key = config.purpose || "";
  const fromPurpose = PURPOSE_COPY[key]?.flowTitle;
  const explicit = TRANSACTION_TITLES[key];
  return fromPurpose || explicit || FLOW_COPY.transaction!.title;
}

export const STATE_TITLES = {
  connecting: "Connecting Wallet",
  approveSign: "Sign Message",
  preparingTransaction: "Preparing Transaction",
  approveTransaction: "Review Transaction",
  error: "Wallet Error",
  default: "Wallet Action",
};

export interface SubCopy { text: string; hint: string; }
export interface PurposeCopyEntry {
  flowTitle: string;
  account?: SubCopy;
  sign?: SubCopy;
  prepare?: SubCopy;
  transaction?: SubCopy;
  errorContext?: string;
}

export const PURPOSE_COPY: Record<string, PurposeCopyEntry> = {
  "connect-operator-wallet": {
    flowTitle: "Connect Wallet",
    account: { text: "Connect Wallet", hint: "Reads the operator wallet address for the agent ENS records. No signature or transaction." },
    prepare: { text: "Reading Operator Wallet...", hint: "Return to the terminal." },
  },
  "create-agent": {
    flowTitle: "Create Agent",
    sign: { text: "Sign With Owner Wallet", hint: "Creates encrypted recovery access. No token approval." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Submits one onchain transaction that mints a new ERC-8004 agent token to this wallet." },
  },
  "restore-owner-wallet": {
    flowTitle: "Owner Wallet Required",
    sign: { text: "Sign With Owner Wallet", hint: "Decrypts this snapshot. No transaction." },
    prepare: { text: "Verifying Owner Wallet...", hint: "Return to the terminal." },
  },
  "restore-operator-wallet": {
    flowTitle: "Operator Wallet Required",
    sign: { text: "Sign With Operator Wallet", hint: "Decrypts this snapshot. No transaction." },
    prepare: { text: "Verifying Operator Wallet...", hint: "Return to the terminal." },
  },
  "update-snapshot-owner": {
    flowTitle: "Owner Wallet Required",
    sign: { text: "Sign With Owner Wallet", hint: "Encrypts local files before publishing. Owner wallet is required because this update changes ownership-protected fields." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated snapshot to the ERC-8004 token URI." },
  },
  "update-snapshot-operator": {
    flowTitle: "Operator Wallet Save",
    sign: { text: "Sign With Operator Wallet", hint: "Signs the encrypted snapshot for restore access." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Operator Wallet", hint: "Publishes the latest agent snapshot through the Vault." },
  },
  "update-snapshot-connected": {
    flowTitle: "Save Snapshot",
    sign: { text: "Sign With Connected Wallet", hint: "Encrypts local files before publishing. Single-wallet setup; no token approval." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Publishes the updated snapshot to the ERC-8004 token URI." },
  },
  "update-ens": {
    flowTitle: "Update ENS in Agent Snapshot",
    sign: { text: "Sign With Owner Wallet", hint: "Saves a new agent snapshot with this ENS name. No onchain ENS records change in this signature." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated ERC-8004 token URI pointing to the new snapshot." },
  },
  "clear-ens": {
    flowTitle: "Unlink ENS from Agent",
    sign: { text: "Sign With Owner Wallet", hint: "Saves a new agent snapshot with no ENS name. No onchain ENS records change in this signature." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated ERC-8004 token URI pointing to the new snapshot." },
  },
  "update-profile-owner": {
    flowTitle: "Owner Wallet Required",
    sign: { text: "Sign With Owner Wallet", hint: "Saves public profile changes. Owner wallet is required because this update changes ownership-protected fields." },
    prepare: { text: "Preparing Profile Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated public profile to the ERC-8004 token URI." },
  },
  "update-profile-operator": {
    flowTitle: "Operator Wallet Profile Update",
    sign: { text: "Sign With Operator Wallet", hint: "Signs the encrypted snapshot for restore access." },
    prepare: { text: "Preparing Profile Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Operator Wallet", hint: "Publishes the updated agent profile through the Vault. No ENS write." },
  },
  "update-profile-connected": {
    flowTitle: "Update Public Profile",
    sign: { text: "Sign With Connected Wallet", hint: "Saves public profile changes. Single-wallet setup; no token approval." },
    prepare: { text: "Preparing Profile Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Publishes the updated public profile to the ERC-8004 token URI." },
  },
  "update-ens-records": {
    flowTitle: "Update ENS Records",
    sign: { text: "Sign With ENS Controller Wallet", hint: "Authorizes ENS record changes. No token approval." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With ENS Controller Wallet", hint: "Submit one Ethereum Mainnet ENS record transaction." },
  },
  "clear-ens-records": {
    flowTitle: "Clear ENS Records",
    sign: { text: "Sign With ENS Controller Wallet", hint: "Authorizes clearing ethagent ENS text records. No token approval." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With ENS Controller Wallet", hint: "Submit one Ethereum Mainnet transaction to clear ethagent ENS text records." },
  },
  "create-simple-ens-subdomain": {
    flowTitle: "Review ENS Subdomain Creation",
    sign: { text: "Sign With Connected Wallet", hint: "Connected wallet owns the ENS root and is creating the agent subdomain." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Creates the agent ENS subdomain on Ethereum Mainnet. Must come from the parent name's owner." },
  },
  "set-simple-ens-records": {
    flowTitle: "Apply ENS Records",
    sign: { text: "Sign With Connected Wallet", hint: "Connected wallet writes the agent ENS records." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Writes the agent ENS text records onchain. Must come from the name's controller." },
  },
  "create-agent-ens-subdomain": {
    flowTitle: "Review Agent ENS Subdomain",
    sign: { text: "Sign With Owner Wallet", hint: "Owner wallet controls the ENS root that the agent subdomain hangs off." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Creates the agent ENS subdomain on Ethereum Mainnet. Must come from the parent name's owner wallet." },
  },
  "set-agent-ens-records": {
    flowTitle: "Apply Agent ENS Records",
    sign: { text: "Sign With Owner Wallet", hint: "Owner wallet writes the agent ENS records pointing at the operator wallet." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Writes the agent ENS text and address records onchain. Must come from the name's controller." },
  },
  "update-operators": {
    flowTitle: "Owner Wallet Required",
    sign: { text: "Sign With Owner Wallet", hint: "Authorizes the new operator wallet access list. No token approval." },
    prepare: { text: "Preparing Operator Wallets...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated operator wallet access list onchain." },
  },
  "operator-proof": {
    flowTitle: "Operator Wallet Required",
    sign: { text: "Sign With Operator Wallet", hint: "Creates restore access. No token approval." },
    prepare: { text: "Verifying Operator Wallet...", hint: "Return to the terminal." },
  },
  "sync-operator-vault": {
    flowTitle: "Owner Wallet Required",
    prepare: { text: "Preparing Vault Operator Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Updates the Vault metadata-operator list so authorized operator wallets can rotate the agent URI." },
  },
  "refetch-snapshot": {
    flowTitle: "Refetch Latest Snapshot",
    sign: { text: "Sign With Any Authorized Wallet", hint: "The owner wallet or any authorized operator wallet can decrypt this snapshot. No transaction." },
    prepare: { text: "Verifying Wallet...", hint: "Return to the terminal." },
  },
  "prepare-transfer-sender": {
    flowTitle: "Submit With Sender Wallet",
    sign: { text: "Sign With Sender Wallet", hint: "Creates sender restore access. No token approval." },
    prepare: { text: "Verifying Sender Wallet...", hint: "Return to the terminal." },
  },
  "prepare-transfer-target": {
    flowTitle: "Switch to Receiver Wallet",
    sign: { text: "Sign With Receiver Wallet", hint: "Creates receiver restore access. No token approval." },
    prepare: { text: "Verifying Receiver Wallet...", hint: "Return to the terminal." },
  },
  "publish-transfer-snapshot": {
    flowTitle: "Switch Back to Sender Wallet",
    prepare: { text: "Preparing Token Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Sender Wallet", hint: "Submits one transaction to publish the transfer snapshot to the ERC-8004 token URI." },
  },
  "deploy-agent-vault": {
    flowTitle: "Deploy Vault",
    prepare: { text: "Preparing Vault Deploy...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Deploys the Vault contract onchain. One-time setup per agent." },
    errorContext: "While submitting the Vault deploy",
  },
  "deposit-agent-vault": {
    flowTitle: "Deposit Token Into Vault",
    prepare: { text: "Preparing Vault Deposit...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Sends the agent token to the Vault so the vault can save updates on your behalf." },
    errorContext: "While submitting the Vault deposit",
  },
  "unwrap-agent-vault": {
    flowTitle: "Unwrap Token From Vault",
    prepare: { text: "Preparing Vault Unwrap...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Returns the agent token from the Vault to your owner wallet." },
  },
  "rotate-agent-uri-vault-owner": {
    flowTitle: "Save Update Through Vault",
    sign: { text: "Sign With Owner Wallet", hint: "Signs the new snapshot before saving onchain. No token approval." },
    prepare: { text: "Preparing Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Saves your update onchain through the Vault. Your token is locked in its dedicated Vault, so updates go through it." },
  },
  "rotate-agent-uri-vault-operator": {
    flowTitle: "Save Update Through Vault",
    sign: { text: "Sign With Operator Wallet", hint: "Signs the new snapshot before saving onchain. No token approval." },
    prepare: { text: "Preparing Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Operator Wallet", hint: "Publishes the latest agent snapshot through the Vault. Your token is locked in its dedicated Vault, so the operator wallet calls the vault to publish." },
  },
  "withdraw-vault": {
    flowTitle: "Withdraw Token From Vault",
    prepare: { text: "Preparing Token Withdrawal...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Temporarily returns the agent token from the vault to your owner wallet. Vault stays configured so you can redeposit later." },
    errorContext: "While submitting the Vault withdraw",
  },
  "delete-ens-subdomain": {
    flowTitle: "Delete ENS Subdomain",
    prepare: { text: "Preparing Subdomain Deletion...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Clears the subdomain entry in the parent ENS name. After this, the label is freed for reuse." },
    errorContext: "While deleting the ENS subdomain",
  },
};

export function purposeCopy(): PurposeCopyEntry {
  const key = config.purpose;
  const copy = PURPOSE_COPY[key || ""];
  if (!copy) {
    throw new Error(
      "Wallet purpose '" + String(key) + "' has no copy entry; refusing to render generic wallet prompt."
    );
  }
  return copy;
}
export function requirePurposeSubCopy(key: keyof PurposeCopyEntry): SubCopy {
  const copy = purposeCopy();
  const sub = copy[key] as SubCopy | undefined;
  if (!sub || typeof sub.text !== "string" || typeof sub.hint !== "string") {
    throw new Error(
      "Wallet purpose '" + String(config.purpose) + "' missing '" + String(key) + "' copy; refusing to render generic wallet prompt."
    );
  }
  return sub;
}
export function accountCopy(): SubCopy { return requirePurposeSubCopy("account"); }
export const ENS_PURPOSES: ReadonlySet<string> = new Set([
  "create-simple-ens-subdomain",
  "set-simple-ens-records",
  "create-agent-ens-subdomain",
  "set-agent-ens-records",
  "update-ens-records",
  "clear-ens-records",
]);
export function isEnsPurpose(purpose: string | undefined): boolean {
  return !!purpose && ENS_PURPOSES.has(purpose);
}
export function ensTokenChainHint(): string {
  const name = typeof config.tokenChainName === "string" ? config.tokenChainName.trim() : "";
  if (!name || !isEnsPurpose(config.purpose)) return "";
  return " Your agent token stays on " + name + "; ENS lives on Ethereum Mainnet.";
}
export function transactionCopy(): SubCopy {
  const txCopy = requirePurposeSubCopy("transaction");
  const expected = config.expectedAccount ? " Required wallet:" + shortAddr(config.expectedAccount) + "." : "";
  const text = config.expectedAccount ? txCopy.text + " (" + shortAddr(config.expectedAccount) + ")" : txCopy.text;
  return { text, hint: txCopy.hint + expected + ensTokenChainHint() };
}
export function signCopy(): SubCopy {
  const sigCopy = requirePurposeSubCopy("sign");
  const expected = config.expectedAccount ? " Required wallet:" + shortAddr(config.expectedAccount) + "." : "";
  const text = config.expectedAccount ? sigCopy.text + " (" + shortAddr(config.expectedAccount) + ")" : sigCopy.text;
  return { text, hint: sigCopy.hint + expected + ensTokenChainHint() };
}

export function chainLabel(hex?: string): string {
  const k = String(hex || "").toLowerCase();
  return (CHAINS[k] && CHAINS[k].name) || ("chain " + k);
}
export function shortAddr(addr?: string): string {
  if (!addr || typeof addr !== "string") return "";
  if (addr.length <= 14) return addr;
  return addr.slice(0, 6) + glyphs.ellipsis + addr.slice(-4);
}
export function isTransactionFlow(): boolean {
  return config.kind === "transaction" || config.kind === "sign-transaction";
}
