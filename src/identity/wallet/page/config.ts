export const config: WalletConfig =
  (window.__WALLET_CONFIG__ as WalletConfig) || {
    sessionToken: 'preview',
    kind: 'sign',
    chainIdHex: '0xaa36a7',
    message: 'identity proof for 0x9F2a???BC4e',
  }

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
  "sign-transaction": { accent: "transaction", tabTitle: "Sign Snapshot",    label: "Snapshot Signature",   title: "Sign Snapshot",    detail: null },
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
  "publish-transfer-snapshot": "Sender Wallet: Publish Snapshot",
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
  cancelled: "Cancelled",
  default: "Wallet Action",
};
