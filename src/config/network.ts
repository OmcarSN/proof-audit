// ProofAudit — Network configuration
// Uses Preview endpoints (contract already deployed there).
// Switching to Preprod is a one-line change once that deploy completes.

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

// Active network — change to 'preprod' once Preprod deploy completes
export const ACTIVE_NETWORK: NetworkId = 'preview';
export const ENDPOINTS: NetworkEndpoints = ACTIVE_NETWORK === 'preprod' ? PREPROD : PREVIEW;

// Deployed contract address (Preview)
export const CONTRACT_ADDRESS: string =
  (import.meta as any).env?.VITE_CONTRACT_ADDRESS?.trim() ||
  '33eaac85c9dd6b17f0d6ce38271bea626a4359d6a1c8b37ba3cb2c2af238e25a';

// Optional block-explorer origin. Set VITE_EXPLORER_BASE to your explorer's
// base URL to turn tx ids and the contract address into clickable links.
// Left empty by default (Midnight's Preview explorer URL isn't pinned here),
// so the UI falls back to copy-to-clipboard — which always works.
export const EXPLORER_BASE: string =
  (import.meta as any).env?.VITE_EXPLORER_BASE?.trim() || '';

export function explorerTxUrl(txId: string): string | null {
  if (!EXPLORER_BASE || !txId) return null;
  return `${EXPLORER_BASE.replace(/\/$/, '')}/tx/${txId}`;
}

export function explorerAddressUrl(address: string): string | null {
  if (!EXPLORER_BASE || !address) return null;
  return `${EXPLORER_BASE.replace(/\/$/, '')}/contract/${address}`;
}
