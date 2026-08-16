// ═══════════════════════════════════════════════════════════════════════
// Vault Circle — Deploy configuration (network endpoints + asset paths)
// ═══════════════════════════════════════════════════════════════════════
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// The compiled Compact artifacts (keys/ + zkir/) live in ../managed/
export const contractConfig = {
  privateStateStoreName: 'vault-circle-private-state',
  // NodeZkConfigProvider reads keys/<circuit>.{prover,verifier} and
  // zkir/<circuit>.bzkir from this directory.
  zkConfigPath: path.resolve(currentDir, '..', 'managed'),
};

export interface NetworkConfig {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class PreprodConfig implements NetworkConfig {
  indexer = 'https://indexer.preprod.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('preprod');
  }
}

export class PreviewConfig implements NetworkConfig {
  indexer = 'https://indexer.preview.midnight.network/api/v3/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v3/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('preview');
  }
}

export function configForNetwork(network: string): NetworkConfig {
  switch (network) {
    case 'preprod':
      return new PreprodConfig();
    case 'preview':
      return new PreviewConfig();
    default:
      throw new Error(`Unknown network "${network}". Use "preprod" or "preview".`);
  }
}
