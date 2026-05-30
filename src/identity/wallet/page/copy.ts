export interface SubCopy { text: string; hint: string; }
export interface PurposeCopyEntry {
  flowTitle: string;
  flowSubtitle?: string;
  account?: SubCopy;
  sign?: SubCopy;
  prepare?: SubCopy;
  transaction?: SubCopy;
  errorContext?: string;
}

export const PURPOSE_COPY: Record<string, PurposeCopyEntry> = {
  "connect-operator-wallet": {
    flowTitle: "Connect Wallet",
    flowSubtitle: "Reads your operator wallet address for the agent's ENS records. No signature.",
    account: { text: "Connect Wallet", hint: "Reads the operator wallet address for the agent ENS records. No signature or transaction." },
    prepare: { text: "Reading Operator Wallet...", hint: "Return to the terminal." },
  },
  "create-agent": {
    flowTitle: "Create Agent",
    flowSubtitle: "Mints a new ERC-8004 agent token to this wallet.",
    sign: { text: "Sign With Owner Wallet", hint: "Creates encrypted recovery access. No token approval." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Submits one onchain transaction that mints a new ERC-8004 agent token to this wallet." },
  },
  "restore-owner-wallet": {
    flowTitle: "Owner Wallet Required",
    flowSubtitle: "Decrypts this snapshot with your owner wallet. No transaction.",
    sign: { text: "Sign With Owner Wallet", hint: "Decrypts this snapshot. No transaction." },
    prepare: { text: "Verifying Owner Wallet...", hint: "Return to the terminal." },
  },
  "restore-operator-wallet": {
    flowTitle: "Operator Wallet Required",
    flowSubtitle: "Decrypts this snapshot with your operator wallet. No transaction.",
    sign: { text: "Sign With Operator Wallet", hint: "Decrypts this snapshot. No transaction." },
    prepare: { text: "Verifying Operator Wallet...", hint: "Return to the terminal." },
  },
  "update-snapshot-owner": {
    flowTitle: "Owner Wallet Required",
    flowSubtitle: "Saves and publishes an updated snapshot that changes ownership-protected fields.",
    sign: { text: "Sign With Owner Wallet", hint: "Signs your owner restore-access key and encrypts local files. Owner wallet is required because this update changes ownership-protected fields." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated snapshot to the ERC-8004 token URI." },
  },
  "update-snapshot-operator": {
    flowTitle: "Operator Wallet: Save Snapshot",
    flowSubtitle: "Publishes the latest agent snapshot through the Vault.",
    sign: { text: "Sign With Operator Wallet", hint: "Signs the encrypted snapshot for restore access." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Operator Wallet", hint: "Publishes the latest agent snapshot through the Vault." },
  },
  "update-snapshot-connected": {
    flowTitle: "Save Snapshot",
    flowSubtitle: "Encrypts your files and publishes the updated snapshot onchain.",
    sign: { text: "Sign With Connected Wallet", hint: "Signs your restore-access key and encrypts local files. Single-wallet setup; no token approval." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Publishes the updated snapshot to the ERC-8004 token URI." },
  },
  "update-ens": {
    flowTitle: "Update ENS in Agent Snapshot",
    flowSubtitle: "Points your agent ENS name at a new snapshot.",
    sign: { text: "Sign With Owner Wallet", hint: "Saves a new agent snapshot with this ENS name. No onchain ENS records change in this signature." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated ERC-8004 token URI pointing to the new snapshot." },
  },
  "clear-ens": {
    flowTitle: "Unlink ENS from Agent",
    flowSubtitle: "Removes the ENS name from your agent snapshot.",
    sign: { text: "Sign With Owner Wallet", hint: "Saves a new agent snapshot with no ENS name. No onchain ENS records change in this signature." },
    prepare: { text: "Saving Snapshot...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated ERC-8004 token URI pointing to the new snapshot." },
  },
  "update-profile-owner": {
    flowTitle: "Owner Wallet Required",
    flowSubtitle: "Saves public profile changes that touch ownership-protected fields.",
    sign: { text: "Sign With Owner Wallet", hint: "Saves public profile changes. Owner wallet is required because this update changes ownership-protected fields." },
    prepare: { text: "Preparing Profile Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated public profile to the ERC-8004 token URI." },
  },
  "update-profile-operator": {
    flowTitle: "Operator Wallet: Update Profile",
    flowSubtitle: "Publishes your updated agent profile through the Vault.",
    sign: { text: "Sign With Operator Wallet", hint: "Signs the encrypted snapshot for restore access." },
    prepare: { text: "Preparing Profile Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Operator Wallet", hint: "Publishes the updated agent profile through the Vault. No ENS write." },
  },
  "update-profile-connected": {
    flowTitle: "Update Public Profile",
    flowSubtitle: "Publishes your updated public agent profile onchain.",
    sign: { text: "Sign With Connected Wallet", hint: "Saves public profile changes. Single-wallet setup; no token approval." },
    prepare: { text: "Preparing Profile Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Publishes the updated public profile to the ERC-8004 token URI." },
  },
  "update-ens-records": {
    flowTitle: "Update ENS Records",
    flowSubtitle: "Writes your agent ENS text records on Ethereum Mainnet.",
    sign: { text: "Sign With ENS Controller Wallet", hint: "Authorizes ENS record changes. No token approval." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With ENS Controller Wallet", hint: "Submit one Ethereum Mainnet ENS record transaction." },
  },
  "clear-ens-records": {
    flowTitle: "Clear ENS Records",
    flowSubtitle: "Clears your agent's ENS text records on Ethereum Mainnet.",
    sign: { text: "Sign With ENS Controller Wallet", hint: "Authorizes clearing ethagent ENS text records. No token approval." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With ENS Controller Wallet", hint: "Submit one Ethereum Mainnet transaction to clear ethagent ENS text records." },
  },
  "create-simple-ens-subdomain": {
    flowTitle: "Review ENS Subdomain Creation",
    flowSubtitle: "Creates the agent ENS subdomain under a name you own.",
    sign: { text: "Sign With Connected Wallet", hint: "Connected wallet owns the ENS root and is creating the agent subdomain." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Creates the agent ENS subdomain on Ethereum Mainnet. Must come from the parent name's owner." },
  },
  "set-simple-ens-records": {
    flowTitle: "Apply ENS Records",
    flowSubtitle: "Writes the agent ENS text records onchain.",
    sign: { text: "Sign With Connected Wallet", hint: "Connected wallet writes the agent ENS records." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Connected Wallet", hint: "Writes the agent ENS text records onchain. Must come from the name's controller." },
  },
  "create-agent-ens-subdomain": {
    flowTitle: "Review Agent ENS Subdomain",
    flowSubtitle: "Creates the agent ENS subdomain under your owner-controlled root.",
    sign: { text: "Sign With Owner Wallet", hint: "Owner wallet controls the ENS root that the agent subdomain hangs off." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Creates the agent ENS subdomain on Ethereum Mainnet. Must come from the parent name's owner wallet." },
  },
  "set-agent-ens-records": {
    flowTitle: "Apply Agent ENS Records",
    flowSubtitle: "Writes the agent ENS records pointing at your operator wallet.",
    sign: { text: "Sign With Owner Wallet", hint: "Owner wallet writes the agent ENS records pointing at the operator wallet." },
    prepare: { text: "Preparing ENS Transaction...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Writes the agent ENS text and address records onchain. Must come from the name's controller." },
  },
  "update-operators": {
    flowTitle: "Owner Wallet Required",
    flowSubtitle: "Publishes a new list of operator wallets allowed to act for the agent.",
    sign: { text: "Sign With Owner Wallet", hint: "Authorizes the new operator wallet access list. No token approval." },
    prepare: { text: "Preparing Operator Wallets...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Publishes the updated operator wallet access list onchain." },
  },
  "operator-proof": {
    flowTitle: "Operator Wallet Required",
    flowSubtitle: "Proves operator wallet control to create restore access. No transaction.",
    sign: { text: "Sign With Operator Wallet", hint: "Creates restore access. No token approval." },
    prepare: { text: "Verifying Operator Wallet...", hint: "Return to the terminal." },
  },
  "sync-operator-vault": {
    flowTitle: "Owner Wallet Required",
    flowSubtitle: "Updates which operator wallets can rotate the agent URI through the Vault.",
    prepare: { text: "Preparing Vault Operator Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Updates the Vault metadata-operator list so authorized operator wallets can rotate the agent URI." },
  },
  "refetch-snapshot": {
    flowTitle: "Refetch Latest Snapshot",
    flowSubtitle: "Decrypts the latest snapshot with any authorized wallet. No transaction.",
    sign: { text: "Sign With Any Authorized Wallet", hint: "The owner wallet or any authorized operator wallet can decrypt this snapshot. No transaction." },
    prepare: { text: "Verifying Wallet...", hint: "Return to the terminal." },
  },
  "prepare-transfer-sender": {
    flowTitle: "Sender Wallet: Sign Snapshot",
    flowSubtitle: "Creates sender restore access for the transfer. No transaction.",
    sign: { text: "Sign With Sender Wallet", hint: "Creates sender restore access. No token approval." },
    prepare: { text: "Verifying Sender Wallet...", hint: "Return to the terminal." },
  },
  "prepare-transfer-target": {
    flowTitle: "Receiver Wallet: Sign Restore Access",
    flowSubtitle: "Creates receiver restore access for the transfer. No transaction.",
    sign: { text: "Sign With Receiver Wallet", hint: "Creates receiver restore access. No token approval." },
    prepare: { text: "Verifying Receiver Wallet...", hint: "Return to the terminal." },
  },
  "publish-transfer-snapshot": {
    flowTitle: "Sender Wallet: Publish Snapshot",
    flowSubtitle: "Publishes the transfer snapshot to the agent token URI.",
    prepare: { text: "Preparing Token Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Sender Wallet", hint: "Submits one transaction to publish the transfer snapshot to the ERC-8004 token URI." },
  },
  "deploy-agent-vault": {
    flowTitle: "Deploy Vault",
    flowSubtitle: "Deploys your agent's Vault contract onchain. One-time setup.",
    prepare: { text: "Preparing Vault Deploy...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Deploys the Vault contract onchain. One-time setup per agent." },
    errorContext: "While submitting the Vault deploy",
  },
  "deposit-agent-vault": {
    flowTitle: "Deposit Token Into Vault",
    flowSubtitle: "Locks the agent token in its Vault so updates route through it.",
    prepare: { text: "Preparing Vault Deposit...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Sends the agent token to the Vault so the vault can save updates on your behalf." },
    errorContext: "While submitting the Vault deposit",
  },
  "unwrap-agent-vault": {
    flowTitle: "Unwrap Token From Vault",
    flowSubtitle: "Returns the agent token from its Vault to your owner wallet.",
    prepare: { text: "Preparing Vault Unwrap...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Returns the agent token from the Vault to your owner wallet." },
  },
  "rotate-agent-uri-vault-owner": {
    flowTitle: "Save Update Through Vault",
    flowSubtitle: "Publishes your latest snapshot onchain through the Vault.",
    sign: { text: "Sign With Owner Wallet", hint: "Signs your owner restore-access key for the new snapshot. No token approval." },
    prepare: { text: "Preparing Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Saves your update onchain through the Vault. Your token is locked in its dedicated Vault, so updates go through it." },
  },
  "rotate-agent-uri-vault-operator": {
    flowTitle: "Save Update Through Vault",
    flowSubtitle: "Publishes your latest snapshot onchain through the Vault.",
    sign: { text: "Sign With Operator Wallet", hint: "Signs your operator restore-access key for the new snapshot. No token approval." },
    prepare: { text: "Preparing Update...", hint: "Keep this page open." },
    transaction: { text: "Submit With Operator Wallet", hint: "Publishes the latest agent snapshot through the Vault. Your token is locked in its dedicated Vault, so the operator wallet calls the vault to publish." },
  },
  "withdraw-vault": {
    flowTitle: "Withdraw Token From Vault",
    flowSubtitle: "Temporarily returns the agent token to your owner wallet; Vault stays configured.",
    prepare: { text: "Preparing Token Withdrawal...", hint: "Keep this page open." },
    transaction: { text: "Submit With Owner Wallet", hint: "Temporarily returns the agent token from the vault to your owner wallet. Vault stays configured so you can redeposit later." },
    errorContext: "While submitting the Vault withdraw",
  },
  "delete-ens-subdomain": {
    flowTitle: "Delete ENS Subdomain",
    flowSubtitle: "Removes the subdomain from its parent ENS name, freeing the label.",
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
export function purposeSubtitle(): string {
  return PURPOSE_COPY[config.purpose || ""]?.flowSubtitle || "";
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
  return { text: txCopy.text, hint: txCopy.hint + ensTokenChainHint() };
}
export function signCopy(): SubCopy {
  const sigCopy = requirePurposeSubCopy("sign");
  return { text: sigCopy.text, hint: sigCopy.hint + ensTokenChainHint() };
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
