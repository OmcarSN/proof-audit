// ═══════════════════════════════════════════════════════════════════════
// No-op shielded wallet stub
//
// The WalletFacade requires a ShieldedWalletAPI for its `shielded` slot,
// but Vault Circle only uses unshielded NIGHT. The real ShieldedWallet
// from wallet-sdk-shielded starts a heavy Rust/WASM sync engine that
// panics ("RuntimeError: unreachable") during genesis backfill on Preprod.
//
// This stub satisfies the interface without loading any WASM. It emits
// a single "already synced" state and no-ops every method the facade
// calls during deployment.
// ═══════════════════════════════════════════════════════════════════════
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type ShieldedWalletAPI, type ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import { BehaviorSubject, type Observable } from 'rxjs';
import { SyncProgress } from '@midnight-ntwrk/wallet-sdk-abstractions';

/**
 * Build a minimal ShieldedWalletState-like object that the FacadeState
 * constructor can consume. The facade's `isSynced` getter checks
 * `this.shielded.state.progress.isStrictlyComplete()`, so we need
 * a progress object where `isConnected && appliedIndex === highestRelevantWalletIndex`.
 */
function makeSyncedShieldedState(secretKeys: ledger.ZswapSecretKeys): ShieldedWalletState {
  // createSyncProgress returns an object with isStrictlyComplete() / isCompleteWithin().
  // isStrictlyComplete() requires isConnected=true and appliedIndex >= highestRelevantWalletIndex.
  const progress = SyncProgress.createSyncProgress({
    appliedIndex: 0n,
    highestRelevantWalletIndex: 0n,
    highestIndex: 0n,
    highestRelevantIndex: 0n,
    isConnected: true,
  });

  // The FacadeState reads:
  //   this.shielded.state.progress.isStrictlyComplete()
  // where `this.shielded` is a ShieldedWalletState, `.state` is the CoreWallet,
  // and `.progress` is a SyncProgress on that CoreWallet.
  //
  // We also need `.balances`, `.coinPublicKey`, `.encryptionPublicKey`, etc.
  // on the ShieldedWalletState for the facade's other methods.
  return {
    protocolVersion: 1n as any,
    state: {
      progress,
    },
    capabilities: {} as any,
    services: {} as any,
    get balances() {
      return {};
    },
    get totalCoins() {
      return [];
    },
    get availableCoins() {
      return [];
    },
    get pendingCoins() {
      return [];
    },
    get coinPublicKey() {
      return secretKeys.coinPublicKey;
    },
    get encryptionPublicKey() {
      return secretKeys.encryptionPublicKey;
    },
    get address() {
      return '' as any;
    },
    get progress() {
      return progress;
    },
    serialize() {
      return '{}';
    },
  } as unknown as ShieldedWalletState;
}

/**
 * Creates a no-op ShieldedWalletAPI that the WalletFacade can use
 * without ever touching the Rust/WASM sync engine.
 */
export function createNoOpShieldedWallet(secretKeys: ledger.ZswapSecretKeys): ShieldedWalletAPI {
  const syncedState = makeSyncedShieldedState(secretKeys);
  const state$ = new BehaviorSubject(syncedState);

  return {
    get state(): Observable<ShieldedWalletState> {
      return state$.asObservable();
    },

    async start(_secretKeys: ledger.ZswapSecretKeys): Promise<void> {
      // No-op — nothing to start without the WASM engine.
    },

    async balanceTransaction(
      _secretKeys: ledger.ZswapSecretKeys,
      _tx: any,
    ): Promise<any> {
      // Return undefined — the facade's merge logic treats undefined as "no shielded balance needed"
      return undefined;
    },

    async transferTransaction(
      _secretKeys: ledger.ZswapSecretKeys,
      _outputs: readonly any[],
    ): Promise<any> {
      throw new Error('Shielded transfers are not supported by this no-op stub.');
    },

    async initSwap(
      _secretKeys: ledger.ZswapSecretKeys,
      _desiredInputs: Record<string, bigint>,
      _desiredOutputs: readonly any[],
    ): Promise<any> {
      throw new Error('Shielded swaps are not supported by this no-op stub.');
    },

    async serializeState(): Promise<string> {
      return '{}';
    },

    async waitForSyncedState(_allowedGap?: bigint): Promise<ShieldedWalletState> {
      return syncedState;
    },

    async getAddress(): Promise<any> {
      return '' as any;
    },

    async revertTransaction(_tx: any): Promise<void> {
      // No-op — no shielded coins to revert.
    },

    async stop(): Promise<void> {
      state$.complete();
    },
  };
}
