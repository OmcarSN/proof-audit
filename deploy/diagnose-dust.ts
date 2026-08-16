/**
 * Query the Midnight Preprod indexer to check:
 * 1. Does the wallet have any DUST state on-chain?
 * 2. Was the registration transaction confirmed?
 * 3. What does the dust wallet actually see?
 */
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { WalletFacade, FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createNoOpShieldedWallet } from './noOpShieldedWallet.js';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import { firstValueFrom } from 'rxjs';
import 'dotenv/config';

// @ts-expect-error
globalThis.WebSocket = WebSocket;

setNetworkId('preprod');

const seed = process.env.VAULT_CIRCLE_SEED;
if (!seed) { console.error('Missing VAULT_CIRCLE_SEED'); process.exit(1); }

const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hdWallet.type !== 'seedOk') { console.error('Bad seed'); process.exit(1); }
const keys = hdWallet.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
if (keys.type !== 'keysDerived') { console.error('Key derivation failed'); process.exit(1); }

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys.keys[Roles.Zswap]);
const dustSecretKey = ledger.DustSecretKey.fromSeed(keys.keys[Roles.Dust]);
const unshieldedKeystore = createKeystore(keys.keys[Roles.NightExternal], getNetworkId());

console.log('Wallet address:', unshieldedKeystore.getBech32Address());
console.log('Public key:', unshieldedKeystore.getPublicKey());
console.log('Dust public key:', dustSecretKey.toString?.() ?? '(no toString)');

console.log('\nInitializing wallet facade...');
const walletConfig = {
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  },
  txHistoryStorage: new NoOpTransactionHistoryStorage(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  provingServerUrl: new URL('http://127.0.0.1:6300'),
  relayURL: new URL('wss://rpc.preprod.midnight.network'),
};

const wallet = await WalletFacade.init({
  configuration: walletConfig,
  shielded: (_cfg) => createNoOpShieldedWallet(shieldedSecretKeys),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
});
await wallet.start(shieldedSecretKeys, dustSecretKey);

console.log('Syncing unshielded...');
await wallet.unshielded.waitForSyncedState();
console.log('✓ Unshielded synced');

// Get state immediately (dust may not be fully synced)
const state = await firstValueFrom(wallet.state());

console.log('\n=== UNSHIELDED STATE ===');
console.log('Balances:', JSON.stringify(state.unshielded.balances, (_, v) => typeof v === 'bigint' ? v.toString() : v));
console.log('Available coins:', state.unshielded.availableCoins.length);
for (const coin of state.unshielded.availableCoins) {
  console.log(`  UTXO: value=${(coin as any).utxo?.value ?? '?'} registered=${(coin as any).meta?.registeredForDustGeneration ?? '?'} ctime=${(coin as any).meta?.ctime ?? '?'}`);
}

console.log('\n=== DUST STATE ===');
console.log('Dust address:', state.dust.address ?? '(none)');
console.log('Dust available coins:', state.dust.availableCoins?.length ?? 0);
console.log('Dust balances:', JSON.stringify(state.dust.balances ?? {}, (_, v) => typeof v === 'bigint' ? v.toString() : v));

// Check dust wallet progress
const dustSnap = await firstValueFrom(wallet.dust.state);
const p = dustSnap?.progress ?? dustSnap?.state?.progress;
console.log('Dust progress:', JSON.stringify(p, (_, v) => typeof v === 'bigint' ? v.toString() : v));

// Wait 30s for dust to sync more
console.log('\nWaiting 30s for dust wallet to sync...');
await new Promise(r => setTimeout(r, 30000));

const state2 = await firstValueFrom(wallet.state());
console.log('\n=== DUST STATE (after 30s) ===');
console.log('Dust available coins:', state2.dust.availableCoins?.length ?? 0);
console.log('Dust balances:', JSON.stringify(state2.dust.balances ?? {}, (_, v) => typeof v === 'bigint' ? v.toString() : v));
const dustSnap2 = await firstValueFrom(wallet.dust.state);
const p2 = dustSnap2?.progress ?? dustSnap2?.state?.progress;
console.log('Dust progress:', JSON.stringify(p2, (_, v) => typeof v === 'bigint' ? v.toString() : v));

// Also dump raw dust state keys
console.log('\n=== RAW DUST STATE KEYS ===');
console.log(Object.keys(state2.dust));
console.log('\nDust state type:', typeof state2.dust);
console.log('Dust coins detail:', JSON.stringify(state2.dust.availableCoins?.slice(0, 3), (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

await wallet.stop();
process.exit(0);
