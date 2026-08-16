// ═══════════════════════════════════════════════════════════════════════
// Vault Circle — Wallet construction + midnight-js provider wiring
// Adapted from midnightntwrk/example-counter (Apache-2.0).
// ═══════════════════════════════════════════════════════════════════════
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { WalletFacade, FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createNoOpShieldedWallet } from './noOpShieldedWallet.js';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import { type NetworkConfig, contractConfig } from './config.js';

// Required for GraphQL subscriptions (wallet sync) in Node.js.
// @ts-expect-error: enable WebSocket usage through the indexer client
globalThis.WebSocket = WebSocket;

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

// buildShieldedConfig removed — we use a no-op shielded wallet stub instead
// of the real WASM-based ShieldedWallet, so its config fields are not needed.

const buildUnshieldedConfig = ({ indexer, indexerWS }: NetworkConfig) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  // wallet-sdk v3 requires a schema arg for InMemoryTransactionHistoryStorage;
  // the deploy flow never reads tx history, so use the no-op storage instead.
  txHistoryStorage: new NoOpTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: NetworkConfig) => ({
  networkId: getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

/** Sign unshielded intents with the correct proof marker (wallet SDK workaround). */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );
    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
};

/**
 * Wait until the wallet is synced enough to transact.
 *
 * The facade's `waitForSyncedState()` hangs because the dust wallet's
 * `highestRelevantWalletIndex` stays 0 for new wallets. Instead we wait for
 * each sub-wallet individually, and for dust we watch `appliedIndex` until it
 * stabilises (stops changing for 15s), meaning it has caught up.
 */
import { firstValueFrom } from 'rxjs';

/**
 * Wait for dust wallet to fully sync by comparing appliedIndex to highestRelevantWalletIndex.
 * The chain has ~1.3M dust events; at ~600 events/s this takes ~37 minutes.
 */
const waitForDustSynced = async (wallet: WalletFacade, maxMs = 24 * 60 * 60 * 1000): Promise<void> => {
  const start = Date.now();

  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 5_000)); // check every 5s
    const ds = await firstValueFrom(wallet.dust.state);
    const p = ds?.progress ?? ds?.state?.progress;
    const applied = BigInt(p?.appliedIndex ?? 0);
    const highest = BigInt(p?.highestRelevantWalletIndex ?? 0);

    if (highest > 0n) {
      const pct = highest > 0n ? Number((applied * 100n) / highest) : 0;
      console.log(`      dust: ${applied}/${highest} (${pct}%)`);
      if (applied >= highest) return;
    } else {
      console.log(`      dust: applied=${applied} (waiting for index…)`);
    }
  }
  console.log('      dust: max wait (60 min) exceeded — proceeding anyway');
};

const waitForSync = async (wallet: WalletFacade): Promise<FacadeState> => {
  console.log('    ⏳ Shielded…');
  await wallet.shielded.waitForSyncedState();
  console.log('    ✓ Shielded synced (no-op)');

  console.log('    ⏳ Unshielded…');
  await wallet.unshielded.waitForSyncedState();
  console.log('    ✓ Unshielded synced');

  console.log('    ⏳ Dust (waiting for indexer backfill to stabilise)…');
  await waitForDustSynced(wallet);
  console.log('    ✓ Dust synced (stabilised)');

  return await firstValueFrom(wallet.state());
};

/**
 * Poll for a non-zero unshielded balance.
 */
const waitForFunds = async (wallet: WalletFacade, pollMs = 15_000): Promise<bigint> => {
  for (;;) {
    const state = await firstValueFrom(wallet.state());
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (balance > 0n) return balance;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

/**
 * Register NIGHT UTXOs for DUST generation, with retries.
 * The dust wallet may falsely report "at tip" during sync; if registration
 * fails with a sync error, we wait for more syncing and retry.
 */
const registerForDustGeneration = async (
  wallet: WalletFacade,
  ctx: WalletContext,
): Promise<void> => {
  const state = await firstValueFrom(wallet.state());

  // Check if dust coins already exist (from a prior run's registration).
  if (state.dust.availableCoins.length > 0) {
    console.log('    ✓ Dust coins already available — skipping registration');
    return;
  }

  // Get unregistered NIGHT UTXOs.
  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => !coin.meta?.registeredForDustGeneration,
  );

  if (nightUtxos.length === 0) {
    console.log('    ✓ All NIGHT UTXOs already registered — proceeding to deploy');
    return;
  }

  const nightVerifyingKey = ctx.unshieldedKeystore.getPublicKey();
  const signFn = (data: Uint8Array) => ctx.unshieldedKeystore.signData(data);

  console.log(`    Registering ${nightUtxos.length} NIGHT UTXO(s) for DUST…`);

  try {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      nightVerifyingKey,
      signFn,
    );

    console.log('    Proving dust registration…');
    const finalizedTx = await wallet.finalizeRecipe(recipe);

    console.log('    Submitting dust registration…');
    await wallet.submitTransaction(finalizedTx);
    console.log('    ✓ Dust registration submitted');

    // Brief wait for coins to appear (30s max)
    console.log('    Waiting briefly for dust coins…');
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await firstValueFrom(wallet.state());
      if (s.dust.availableCoins.length > 0) {
        console.log(`    ✓ DUST available (${s.dust.availableCoins.length} coin(s))`);
        return;
      }
    }
    console.log('    ⚠ Dust coins not yet visible — proceeding to deploy anyway');
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    console.log(`    ⚠ Registration failed: ${msg.slice(0, 200)}`);
    console.log('    Proceeding to deploy anyway…');
  }
};

/** Poll for dust coins (up to 3 min). Returns true if found. */
const waitForDustCoins = async (wallet: WalletFacade): Promise<boolean> => {
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await firstValueFrom(wallet.state());
    if (s.dust.availableCoins.length > 0) {
      console.log(`    ✓ DUST available (${s.dust.availableCoins.length} coin(s))`);
      return true;
    }
    if (i % 6 === 0) {
      const dp = (s as any).dust?.state?.progress ?? (s as any).dust?.progress;
      console.log(`      waiting for dust coins… (applied=${dp?.appliedIndex ?? '?'})`);
    }
  }
  console.log('    ⚠ Dust coins not yet available');
  return false;
};

/**
 * Build the wallet from a hex seed, print the funding address, and wait until
 * it is synced and holds tNight. Returns the wallet context for deployment.
 */
export const buildWalletAndWaitForFunds = async (
  config: NetworkConfig,
  seed: string,
): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = {
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (_cfg) => createNoOpShieldedWallet(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  const fundAddress = unshieldedKeystore.getBech32Address();
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Vault Circle wallet                         Network: ${getNetworkId()}
${DIV}
  Fund this address with tNight from the faucet:

  ${fundAddress}

  Faucet: https://faucet.${getNetworkId()}.midnight.network/
${DIV}
`);

  console.log('  Syncing wallet with the network… (a fresh wallet backfills from genesis; this can take several minutes)');
  const syncedState = await waitForSync(wallet);
  console.log('  ✓ Wallet synced');

  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    console.log('  Waiting for incoming tNight — fund the address above, this will continue automatically…');
    const funded = await waitForFunds(wallet);
    console.log(`  ✓ Funds received: ${funded.toLocaleString()} tNight`);
  } else {
    console.log(`  ✓ Balance: ${balance.toLocaleString()} tNight`);
  }


  console.log('  Registering NIGHT for DUST generation (fee token)…');
  await registerForDustGeneration(wallet, { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore });

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

/** Return just the unshielded funding address for a seed, without syncing. */
export const addressForSeed = (seed: string): string => {
  const keys = deriveKeysFromSeed(seed);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());
  return unshieldedKeystore.getBech32Address();
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  return {
    getCoinPublicKey() {
      // CoinPublicKey is a string alias — no .toHexString() needed.
      return ctx.shieldedSecretKeys.coinPublicKey;
    },
    getEncryptionPublicKey() {
      // EncPublicKey is a string alias — no .toHexString() needed.
      return ctx.shieldedSecretKeys.encryptionPublicKey;
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

export const configureProviders = async (ctx: WalletContext, config: NetworkConfig) => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider(contractConfig.zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};
