import type { WalletTx } from './types.js'
import { WALLET_PROVIDER_POLL_MS, WALLET_PROVIDER_WAIT_MS } from './constants.js'

let announcedEthereum: any = null;
let activeEthereum: any = null;

function rememberAnnouncedProvider(event: any): void {
  const provider = event && event.detail && event.detail.provider;
  if (provider && !announcedEthereum) announcedEthereum = provider;
}
window.addEventListener("eip6963:announceProvider", rememberAnnouncedProvider as EventListener);
try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (_) { }

export function ethereumProvider(): any { return activeEthereum || (window as any).ethereum || announcedEthereum; }
export function noWalletError(): Error { return new Error("No wallet detected. Install a wallet and retry."); }

export function waitForEthereumProvider(timeoutMs?: number): Promise<any> {
  const existing = ethereumProvider();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("ethereum#initialized", check);
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const check = () => { const provider = ethereumProvider(); if (provider) finish(() => resolve(provider)); };
    const onAnnounce = (event: any) => { rememberAnnouncedProvider(event); check(); };
    const timer = setTimeout(() => finish(() => reject(noWalletError())), timeoutMs || WALLET_PROVIDER_WAIT_MS);
    const interval = setInterval(check, WALLET_PROVIDER_POLL_MS);
    window.addEventListener("ethereum#initialized", check);
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (_) { }
    check();
  });
}

export let currentWalletMethod: string | null = null;
export async function walletRequest(method: string, params?: any): Promise<any> {
  const provider = ethereumProvider();
  if (!provider) throw noWalletError();
  currentWalletMethod = method;
  try {
    return await provider.request(params === undefined ? { method } : { method, params });
  } finally {
    currentWalletMethod = null;
  }
}

export function buildTxParams(account: string, tx: WalletTx): Record<string, string> {
  if (!tx || typeof tx.data !== "string") {
    throw new Error("Transaction is missing call data.");
  }
  const params: Record<string, string> = { from: account, data: tx.data };
  if (typeof tx.to === "string" && tx.to.length > 0) params.to = tx.to;
  if (typeof tx.value === "string" && tx.value.length > 0) params.value = tx.value;
  if (typeof tx.gas === "string" && tx.gas.length > 0) params.gas = tx.gas;
  if (typeof tx.maxFeePerGas === "string" && tx.maxFeePerGas.length > 0) params.maxFeePerGas = tx.maxFeePerGas;
  if (typeof tx.maxPriorityFeePerGas === "string" && tx.maxPriorityFeePerGas.length > 0) params.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
  return params;
}
export function setActiveEthereum(provider: unknown): void { activeEthereum = provider }
export function clearCurrentWalletMethod(): void { currentWalletMethod = null }
