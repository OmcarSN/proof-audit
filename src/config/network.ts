// ProofAudit — Network configuration
// Active network is Preprod, where the contract is deployed (9cf5ec73…) and
// verified on-chain. The contract is also deployed on Preview (33eaac85…);
// both addresses are kept below so switching ACTIVE_NETWORK just works.

export type NetworkId = 'preprod' | 'preview';

export interface NetworkEndpoints {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export const PREVIEW: NetworkEndpoints = {
  indexer: 'https://indexer.preview.midnight.network/api/v3/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  proofServer: 'http://127.0.0.1:6300',
};

export const PREPROD: NetworkEndpoints = {
  indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer: 'http://127.0.0.1:6300',
};

// Active network. The contract is deployed on BOTH testnets; the app runs on
// Preprod (deploy 9cf5ec73…, verified on-chain via the Preprod indexer).
export const ACTIVE_NETWORK: NetworkId = 'preprod';
export const ENDPOINTS: NetworkEndpoints = ACTIVE_NETWORK === 'preprod' ? PREPROD : PREVIEW;

// Deployed contract address per network.
export const PREPROD_CONTRACT = '9cf5ec73a7330def5f7730569d0b898572d5fdde78863ddb14f0f451493f117d';
export const PREVIEW_CONTRACT = '33eaac85c9dd6b17f0d6ce38271bea626a4359d6a1c8b37ba3cb2c2af238e25a';

// Address used by the app (env override wins; else the active network's address).
export const CONTRACT_ADDRESS: string =
  (import.meta as any).env?.VITE_CONTRACT_ADDRESS?.trim() ||
  (ACTIVE_NETWORK === 'preprod' ? PREPROD_CONTRACT : PREVIEW_CONTRACT);

// Human-readable label for the active network, used in UI copy.
export const NETWORK_LABEL: string = ACTIVE_NETWORK === 'preprod' ? 'Preprod' : 'Preview';

// Optional block-explorer origin. Set VITE_EXPLORER_BASE to your explorer's
// base URL to turn tx ids and the contract address into clickable links.
// Left empty by default (Midnight's Preview explorer URL isn't pinned here),
// so the UI falls back to copy-to-clipboard — which always works.
export const EXPLORER_BASE: string =
  (import.meta as any).env?.VITE_EXPLORER_BASE?.trim() || '';

export function explorerTxUrl(txId: string): string | null {
  // 'submitted' is our placeholder for a broadcast tx whose id the wallet did
  // not return — it isn't a real hash, so never build a (broken) link for it.
  if (!EXPLORER_BASE || !txId || txId === 'submitted') return null;
  return `${EXPLORER_BASE.replace(/\/$/, '')}/tx/${txId}`;
}

export function explorerAddressUrl(address: string): string | null {
  if (!EXPLORER_BASE || !address) return null;
  return `${EXPLORER_BASE.replace(/\/$/, '')}/contract/${address}`;
}
