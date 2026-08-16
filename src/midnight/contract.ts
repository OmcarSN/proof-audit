// ═══════════════════════════════════════════════════════════════════════
// ProofAudit — Circuit call + on-chain read
//
// WRITE (submitAttestation): generates a ZK proof locally (Docker proof
// server, :6300), then submits the proven transaction through the connected
// Lace wallet. The `findings` array is the PRIVATE WITNESS — used only for
// local proof generation, never sent to the chain.
//
// READ (readAttestation): reads the public ledger state straight from the
// indexer — no wallet and no proof server needed — to show a stored verdict.
// ═══════════════════════════════════════════════════════════════════════

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { DAppConnectorWalletAPI, WalletState } from './connector';
import { ACTIVE_NETWORK, CONTRACT_ADDRESS, ENDPOINTS } from '../config/network';
import { bytesToHex } from '../lib/hash';

// Address decoding + provers key off the active network id; set it once here.
setNetworkId(ACTIVE_NETWORK);

const PRIVATE_STATE_ID = 'proofAuditPrivateState';

// Where the browser fetches the proving keys + compiled circuit from. These
// files are copied from managed/{keys,zkir} into public/zk (served at /zk).
const ZK_ASSETS_BASE_URL = '/zk';

// Encrypts the local (empty) private-state store kept in the browser's
// IndexedDB. This is NOT a secret that protects funds — it only needs to
// satisfy the toolkit's password policy (>=16 chars, mixed character classes).
const LOCAL_STORE_PASSWORD = 'ProofAudit#Zk7$Ledger9!Qx';

export interface AttestationResult {
  passed: boolean;
  txId: string;
  /** Hex of the 32-byte hash, so the UI can offer "verify this on-chain". */
  contractHashHex: string;
}

/** A verdict read back from the chain. `null` from readAttestation = not found. */
export interface AttestationView {
  passed: boolean;
  severityThreshold: number;
  timestamp: bigint;
}

/**
 * Submit an attestation. Returns the (locally-computed) verdict for an
 * instant result — the authoritative on-chain value can then be read with
 * readAttestation() once the indexer has caught up (see the Verify tab).
 */
export async function callSubmitAttestation(
  walletApi: DAppConnectorWalletAPI,
  walletState: WalletState,
  contractHash: Uint8Array,
  severityThreshold: bigint,
  findings: [bigint, bigint, bigint],
): Promise<AttestationResult> {
  if (!CONTRACT_ADDRESS) {
    throw new Error('No contract address configured. Deploy the contract first.');
  }

  // Load the heavy SDK modules only when a submit actually happens.
  const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');
  const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
  const { levelPrivateStateProvider } = await import('@midnight-ntwrk/midnight-js-level-private-state-provider');
  const { FetchZkConfigProvider } = await import('./zkConfigProvider');
  const { Contract } = await import('../../managed/contract/index.js');

  // ── Providers: the browser twin of deploy/wallet.ts `configureProviders`. ──
  // The proving keys + compiled circuit are fetched over HTTP from /zk.
  const zkConfigProvider = new FetchZkConfigProvider<string>(ZK_ASSETS_BASE_URL);

  // Reads the public ledger state (no wallet, no proof server needed).
  const publicDataProvider = indexerPublicDataProvider(ENDPOINTS.indexer, ENDPOINTS.indexerWS);

  // Builds the circuit proof by calling the local proof server, which reads the
  // keys + zkIR through zkConfigProvider.
  const proofProvider = httpClientProofProvider(ENDPOINTS.proofServer, zkConfigProvider);

  // A per-browser store for private state. Our contract declares no witnesses
  // and its private state is empty, so this is used only trivially.
  const accountId = walletState.coinPublicKey || walletState.address || 'proofaudit';
  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: 'proofaudit-private-state',
    accountId,
    privateStoragePasswordProvider: () => LOCAL_STORE_PASSWORD,
  });

  // Lace does the wallet work: balancing (fees), proving the balance, signing,
  // and submitting. We adapt its connector API to the toolkit's provider shape
  // (getCoinPublicKey / getEncryptionPublicKey / balanceTx / submitTx).
  const laceProvider = {
    getCoinPublicKey() {
      return walletState.coinPublicKey;
    },
    getEncryptionPublicKey() {
      return walletState.encryptionPublicKey ?? '';
    },
    async balanceTx(tx: any) {
      return walletApi.balanceAndProveTransaction(tx);
    },
    submitTx(tx: any) {
      return walletApi.submitTransaction(tx);
    },
  };

  const providers = {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider: laceProvider,
    midnightProvider: laceProvider,
  };

  // Wrap the compiled contract exactly as deploy/deploy.ts does. Our contract
  // declares no witnesses, so we associate an empty witness set. (The call path
  // reads its ZK assets from zkConfigProvider above, not from this path.)
  const compiledContract = CompiledContract.make('proof_audit', Contract).pipe(
    CompiledContract.withWitnesses({}),
    CompiledContract.withCompiledFileAssets(ZK_ASSETS_BASE_URL),
  );

  const deployed = await findDeployedContract(providers as any, {
    compiledContract,
    contractAddress: CONTRACT_ADDRESS,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  } as any);

  // `findings` is the PRIVATE WITNESS: it is used only to build the local proof
  // and never appears on-chain. The chain records only the pass/fail verdict.
  const result: any = await (deployed as any).callTx.submitAttestation(
    contractHash,
    severityThreshold,
    findings,
  );

  // Mirror the circuit's own rule for an immediate verdict; the authoritative
  // value can be read back from the chain via the Verify tab.
  const passed =
    severityThreshold > 0n &&
    findings[0] < severityThreshold &&
    findings[1] < severityThreshold &&
    findings[2] < severityThreshold;

  return {
    passed,
    txId:
      result?.public?.txId ||
      result?.txId ||
      result?.public?.txHash ||
      result?.deployTxData?.public?.txId ||
      'submitted',
    contractHashHex: bytesToHex(contractHash),
  };
}

/**
 * Read a stored attestation from the public ledger, keyed by the 32-byte hash.
 * Reads happen through the indexer only — no wallet, no proof server.
 * Returns null when nothing has been attested for that hash.
 */
export async function readAttestation(contractHash: Uint8Array): Promise<AttestationView | null> {
  if (!CONTRACT_ADDRESS) {
    throw new Error('No contract address configured.');
  }

  const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const { ledger } = await import('../../managed/contract/index.js');

  const publicDataProvider = indexerPublicDataProvider(ENDPOINTS.indexer, ENDPOINTS.indexerWS);

  const contractState = await publicDataProvider.queryContractState(CONTRACT_ADDRESS);
  if (!contractState) return null;

  const state = ledger(contractState.data);
  if (!state.attestations.member(contractHash)) return null;

  const a = state.attestations.lookup(contractHash);
  return {
    passed: a.passed,
    severityThreshold: Number(a.severityThreshold),
    timestamp: a.timestamp,
  };
}
