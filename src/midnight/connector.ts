// ═══════════════════════════════════════════════════════════════════════
// ProofAudit — Midnight DApp Connector wrapper
// Adapted from vault-circle reference
// ═══════════════════════════════════════════════════════════════════════

export interface ServiceUriConfig {
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
  readonly proverServerUri: string;
}

export interface WalletState {
  readonly address: string;
  readonly coinPublicKey: string;
  readonly encryptionPublicKey?: string;
  readonly balances?: Record<string, string | number | bigint>;
}

export interface DAppConnectorWalletAPI {
  state(): Promise<WalletState>;
  balanceAndProveTransaction(tx: unknown, newCoins?: unknown[]): Promise<unknown>;
  submitTransaction(tx: unknown): Promise<string>;
}

export interface DAppConnectorAPI {
  readonly apiVersion: string;
  readonly name: string;
  readonly icon?: string;
  isEnabled(): Promise<boolean>;
  enable(): Promise<DAppConnectorWalletAPI>;
  serviceUriConfig(): Promise<ServiceUriConfig>;
}

declare global {
  interface Window {
    midnight?: Record<string, DAppConnectorAPI | undefined>;
  }
}

const PREFERRED_KEYS = ['mnLace', 'lace', 'midnight', 'midnightLace', 'midnightWallet'];

export interface InjectionDebug {
  hasMidnight: boolean;
  keys: string[];
  chosenKey: string | null;
}

export function inspectInjection(): InjectionDebug {
  const mid = typeof window !== 'undefined' ? window.midnight : undefined;
  if (!mid) return { hasMidnight: false, keys: [], chosenKey: null };

  const keys = Object.keys(mid).filter((k) => !!mid[k]);
  for (const k of PREFERRED_KEYS) {
    if (!keys.includes(k) && (mid as any)[k]) {
      keys.push(k);
    }
  }

  return {
    hasMidnight: true,
    keys,
    chosenKey: pickKey(keys),
  };
}

function pickKey(keys: string[]): string | null {
  for (const p of PREFERRED_KEYS) if (keys.includes(p)) return p;
  return keys[0] ?? null;
}

export function isWalletAvailable(): boolean {
  return inspectInjection().chosenKey !== null;
}

export async function waitForConnector(timeoutMs = 4000): Promise<DAppConnectorAPI | null> {
  const started = performance.now();
  while (true) {
    const { chosenKey } = inspectInjection();
    if (chosenKey && window.midnight?.[chosenKey]) {
      return window.midnight[chosenKey]!;
    }
    if (performance.now() - started > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
}

export function getConnector(): DAppConnectorAPI {
  const { chosenKey } = inspectInjection();
  const connector = chosenKey ? window.midnight?.[chosenKey] : undefined;
  if (!connector) {
    throw new Error('Lace wallet not detected — install it from lace.io. Ensure it is enabled in your browser.');
  }
  return connector;
}

export interface ConnectionInfo {
  readonly api: DAppConnectorWalletAPI;
  readonly state: WalletState;
  readonly uris: ServiceUriConfig;
  readonly walletName: string;
  readonly apiVersion: string;
  readonly connectorKey: string;
}

function chosenConnector(): DAppConnectorAPI | null {
  const { chosenKey } = inspectInjection();
  return chosenKey ? (window.midnight?.[chosenKey] ?? null) : null;
}

export async function connectLace(): Promise<ConnectionInfo> {
  let connector = chosenConnector();
  if (!connector) {
    connector = (await waitForConnector(3000)) ?? getConnector();
  }

  const chosenKey = inspectInjection().chosenKey ?? 'mnLace';

  let api: DAppConnectorWalletAPI;
  const networkId = 'preview';

  try {
    if (typeof (connector as any).connect === 'function') {
      api = await (connector as any).connect(networkId);
    } else if (typeof connector.enable === 'function') {
      api = await (connector as any).enable(networkId);
    } else {
      throw new Error('Wallet connector does not expose an enable() or connect() method.');
    }
  } catch (err: any) {
    // If preview fails, retry with preprod in case Lace is on preprod
    try {
      if (typeof (connector as any).connect === 'function') {
        api = await (connector as any).connect('preprod');
      } else if (typeof connector.enable === 'function') {
        api = await (connector as any).enable('preprod');
      } else {
        throw err;
      }
    } catch {
      const msg = String(err?.message ?? err);
      if (msg.toLowerCase().includes('reject') || err?.code === 4001) {
        throw new Error('Connection rejected. Please approve the connection request in the Lace wallet popup.');
      }
      throw new Error(`Wallet connection failed: ${msg}`);
    }
  }

  const fetchUris = typeof connector.serviceUriConfig === 'function'
    ? connector.serviceUriConfig()
    : Promise.resolve({
        indexerUri: 'https://indexer.preview.midnight.network/api/v3/graphql',
        indexerWsUri: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
        nodeUri: 'wss://rpc.preview.midnight.network',
        proverServerUri: 'http://127.0.0.1:6300',
      });

  const [state, uris] = await Promise.all([
    extractWalletState(api),
    fetchUris,
  ]);

  return {
    api,
    state,
    uris,
    walletName: connector.name || 'Midnight Lace',
    apiVersion: connector.apiVersion || '1.0.0',
    connectorKey: chosenKey,
  };
}

async function extractWalletState(api: any): Promise<WalletState> {
  let raw: any = null;

  try {
    let stateResult: any;
    if (typeof api.state === 'function') {
      stateResult = api.state();
    } else if (typeof api.getState === 'function') {
      stateResult = api.getState();
    } else {
      stateResult = api.state || api.state$ || api;
    }

    if (stateResult && typeof stateResult.then === 'function') {
      raw = await stateResult;
    } else if (stateResult && typeof stateResult.subscribe === 'function') {
      raw = await new Promise((resolve, reject) => {
        const sub = stateResult.subscribe({
          next: (v: any) => { sub.unsubscribe(); resolve(v); },
          error: (err: any) => reject(err),
        });
      });
    } else {
      raw = stateResult;
    }
  } catch {
    raw = api;
  }

  const address =
    typeof raw === 'string'
      ? raw
      : raw?.address ||
        raw?.bech32Address ||
        raw?.unshieldedAddress ||
        raw?.publicKeys?.coinPublicKey ||
        '';

  const coinPublicKey =
    raw?.coinPublicKey ||
    raw?.publicKeys?.coinPublicKey ||
    raw?.coinKey ||
    '';

  const encryptionPublicKey =
    raw?.encryptionPublicKey ||
    raw?.publicKeys?.encryptionPublicKey ||
    raw?.encryptionKey ||
    '';

  const balances = raw?.balances || raw?.balance || {};

  return {
    address,
    coinPublicKey,
    encryptionPublicKey,
    balances,
  };
}

export async function isAlreadyConnected(): Promise<boolean> {
  try {
    const connector = await waitForConnector(1500);
    if (!connector) return false;
    if (typeof connector.isEnabled === 'function') {
      return (await connector.isEnabled('preview' as any)) || (await connector.isEnabled());
    }
    return false;
  } catch {
    return false;
  }
}

export const DISCONNECT_HINT =
  'Disconnected locally. To fully revoke access, open Lace → Settings → Connected dApps and remove this site.';
