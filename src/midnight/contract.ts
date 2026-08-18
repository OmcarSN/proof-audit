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
import { readWalletState } from './connector';
import type { DAppConnectorWalletAPI, WalletState } from './connector';
import { ACTIVE_NETWORK, CONTRACT_ADDRESS, ENDPOINTS } from '../config/network';
import { bytesToHex } from '../lib/hash';

// Address decoding + provers key off the active network id; set it once here.
setNetworkId(ACTIVE_NETWORK);

const PRIVATE_STATE_ID = 'proofAuditPrivateState';

// Where the browser fetches the proving keys + compiled circuit from. These
// files are copied from managed/{keys,zkir} into public/zk (served at /zk).
const ZK_ASSETS_BASE_URL = '/zk';

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

/** One-line shape dump for diagnostics: object → keys:type, string → str(len). */
function describeShape(o: any, depth = 0): string {
  if (o === null || o === undefined) return String(o);
  if (typeof o === 'string') return `str(${o.length})`;
  if (typeof o !== 'object') return typeof o;
  if (depth > 1) return Array.isArray(o) ? 'array' : 'object';
  const entries = Object.keys(o).slice(0, 24).map((k) => `${k}:${describeShape(o[k], depth + 1)}`);
  return `{${entries.join(', ')}}`;
}

/** Comma-separated list of an object's function-valued keys (for diagnostics). */
function fnNames(o: any): string {
  try {
    return Object.keys(o).filter((k) => typeof o[k] === 'function').join(',');
  } catch {
    return '?';
  }
}

/**
 * Method names on an object's PROTOTYPE (for diagnostics). wasm-bindgen objects
 * (like a ledger Transaction) carry `{__wbg_ptr}` as their only own key and put
 * every method — serialize(), toString(), … — on the prototype, so plain
 * Object.keys/fnNames misses them.
 */
function protoNames(o: any): string {
  try {
    const proto = Object.getPrototypeOf(o);
    if (!proto) return '';
    return Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor')
      .slice(0, 30)
      .join(',');
  } catch {
    return '?';
  }
}

/**
 * Walk an Effect-TS `Cause` tree to its innermost real error and describe it.
 * A FiberFailure keeps the actual failure in a Symbol-keyed `Cause` object while
 * leaving its own `.message` empty — so without unwrapping this, the banner just
 * reads "(empty message)" and hides the real reason (e.g. insufficient
 * funds/dust to pay the fee, or a rejected balance).
 */
function unwrapEffectCause(cause: any, seen: Set<any>, depth: number): string {
  if (cause == null || typeof cause !== 'object' || depth > 6 || seen.has(cause)) return '';
  seen.add(cause);
  const tag = cause._tag;
  if (tag === 'Fail' && cause.error != null) return describeErr(cause.error, depth + 1);
  if (tag === 'Die' && cause.defect != null) return describeErr(cause.defect, depth + 1);
  if (tag === 'Interrupt') return 'fiber interrupted';
  // Sequential/Parallel branches, or any nested wrapper field.
  for (const k of ['error', 'defect', 'cause', 'left', 'right', 'value', 'current']) {
    const s = unwrapEffectCause(cause[k], seen, depth + 1);
    if (s) return s;
  }
  return '';
}

/**
 * Human-readable one-liner for ANY thrown value — including the opaque,
 * empty-message `Error`s the wallet/SDK sometimes throw. Pulls the error's
 * name, message, the first stack frame (which file/function actually threw),
 * and any own properties (wallet errors often stash the real reason on a custom
 * field). Also unwraps Effect-TS FiberFailure causes (Symbol-keyed) and the
 * `.cause` chain, so the banner shows something actionable instead of "Error".
 */
function describeErr(e: any, depth = 0): string {
  if (e == null) return String(e);
  if (typeof e === 'string') return e;
  if (depth > 6) return e.name || 'Error';
  const name = e.name || e.constructor?.name || 'Error';
  let msg = e.message ? String(e.message) : '';

  // Effect-TS FiberFailure reports an empty top-level message and hides the real
  // failure in a Symbol-keyed Cause. Recover it so the reason is actually shown.
  if (!msg) {
    try {
      const seen = new Set<any>();
      for (const sym of Object.getOwnPropertySymbols(e)) {
        const found = unwrapEffectCause((e as any)[sym], seen, 0);
        if (found) {
          msg = found;
          break;
        }
      }
    } catch {
      /* symbol access can throw on exotic objects; ignore */
    }
  }

  let frame = '';
  if (typeof e.stack === 'string') {
    const lines = e.stack.split('\n').map((l: string) => l.trim());
    frame = lines.find((l: string, i: number) => i > 0 && l.startsWith('at')) ?? '';
  }
  let props = '';
  try {
    const skip = new Set(['message', 'stack', 'cause']);
    const own = Object.getOwnPropertyNames(e).filter((k) => !skip.has(k));
    if (own.length) {
      const obj = Object.fromEntries(own.map((k) => [k, (e as any)[k]]));
      props =
        ' ' +
        JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 240);
    }
  } catch {
    /* some fields aren't serializable; skip them */
  }
  // Follow the `.cause` chain too: SDK wrappers (and our own balanceTx wrapper,
  // whose message was frozen before we could unwrap it) nest the live
  // FiberFailure there, so recursing reaches the real reason.
  let causeStr = '';
  const cause = (e as any).cause;
  if (cause != null && cause !== e && depth < 4) {
    const c = describeErr(cause, depth + 1);
    if (c && !msg.includes(c)) causeStr = ` ← ${c}`;
  }
  return `${name}: ${msg || '(empty message)'}${frame ? ` @ ${frame}` : ''}${props}${causeStr}`;
}

/**
 * Newer (DUST-model) Lace no longer exposes the shielded keys on state(). It
 * does expose shielded ADDRESSES; decode one with wallet-sdk-address-format to
 * recover the coin + encryption public keys as hex (which the toolkit accepts —
 * parseCoinPublicKeyToHex returns a hex input unchanged).
 */
async function deriveShieldedKeys(
  api: any,
): Promise<{ coinPublicKey: string; encryptionPublicKey: string; debug: string }> {
  const { MidnightBech32m, ShieldedAddress } = (await import(
    '@midnight-ntwrk/wallet-sdk-address-format'
  )) as any;

  let addrs: any;
  if (typeof api.getShieldedAddresses === 'function') addrs = await api.getShieldedAddresses();
  else if (typeof api.getShieldedAddress === 'function') addrs = await api.getShieldedAddress();
  else throw new Error(`no getShieldedAddress(es) method (fns: ${fnNames(api)})`);

  const first = Array.isArray(addrs) ? addrs[0] : addrs;
  const addrStr =
    typeof first === 'string'
      ? first
      : first?.address ?? first?.value ?? first?.bech32 ?? first?.shieldedAddress ?? '';
  if (!addrStr) throw new Error(`empty shielded address (got ${describeShape(addrs)})`);

  const parsed = MidnightBech32m.parse(addrStr);
  const decoded = parsed.decode(ShieldedAddress, parsed.network);
  return {
    coinPublicKey: decoded.coinPublicKey.toHexString(),
    encryptionPublicKey: decoded.encryptionPublicKey.toHexString(),
    debug: `derived net=${String(parsed.network)}`,
  };
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

  // Make sure the wallet is unlocked & authorized RIGHT NOW. Lace auto-locks
  // after a few minutes of inactivity, and a locked wallet does NOT pop up on
  // its own when we read its keys — it just throws "Wallet is locked". Re-running
  // the connector's enable()/connect() is the spec's way to (re)prompt: it shows
  // Lace's unlock/approve popup when needed and resolves silently if the wallet
  // is already open, handing back a fresh, unlocked API to use below.
  let walletApiLive: any = walletApi;
  try {
    const { getConnector } = await import('./connector');
    const connector: any = getConnector();
    if (typeof connector.connect === 'function') {
      walletApiLive = (await connector.connect(ACTIVE_NETWORK)) ?? walletApi;
    } else if (typeof connector.enable === 'function') {
      walletApiLive = (await connector.enable(ACTIVE_NETWORK)) ?? walletApi;
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e).toLowerCase();
    if (e?.code === 4001 || msg.includes('reject') || msg.includes('denied') || msg.includes('closed')) {
      throw new Error('Unlock Lace and approve the request, then click submit again.');
    }
    // Any other issue: fall back to the API we were handed and let the
    // key-resolution step below report a precise diagnostic.
  }

  // Load the heavy SDK modules only when a submit actually happens.
  const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');
  const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
  const { inMemoryPrivateStateProvider } = await import('./inMemoryPrivateStateProvider');
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

  // Our contract declares no witnesses and its private state is empty, so we
  // use a dependency-free in-memory store. (The stock level/IndexedDB provider
  // can't even load in the browser — see inMemoryPrivateStateProvider.)
  const privateStateProvider = inMemoryPrivateStateProvider();

  // Lace does the wallet work: balancing (fees), proving the balance, signing,
  // and submitting. We adapt its connector API to the toolkit's provider shape
  // (getCoinPublicKey / getEncryptionPublicKey / balanceTx / submitTx).
  //
  // Re-read the wallet state HERE rather than trusting the copy captured at
  // connect time: Lace fills in the shielded coin/encryption public keys only
  // once it finishes syncing, so the connect-time snapshot can still hold empty
  // keys — and an empty coin key is exactly what makes the ledger throw
  // "invalid string length 0" while building the transaction.
  // ── Resolve the shielded coin + encryption public keys ─────────────────
  // Old Lace exposed them on state(); the newer DUST-model Lace does not —
  // there we derive them by decoding a shielded ADDRESS (getShieldedAddresses)
  // with wallet-sdk-address-format. Try the state copy first, then derive.
  const { state: freshState, raw: rawState } = await readWalletState(walletApiLive);
  let coinPublicKey = freshState.coinPublicKey || walletState.coinPublicKey || '';
  let encryptionPublicKey =
    freshState.encryptionPublicKey || walletState.encryptionPublicKey || '';
  let keyDebug = 'from-state';

  if (!coinPublicKey || !encryptionPublicKey) {
    try {
      const derived = await deriveShieldedKeys(walletApiLive);
      coinPublicKey = coinPublicKey || derived.coinPublicKey;
      encryptionPublicKey = encryptionPublicKey || derived.encryptionPublicKey;
      keyDebug = derived.debug;
    } catch (e: any) {
      keyDebug = `derive-failed: ${e?.message ?? String(e)}`;
    }
  }

  if (!coinPublicKey || !encryptionPublicKey) {
    // A locked wallet is the most common cause, and NO dApp can unlock it — so
    // guide the user to do it in the extension instead of dumping diagnostics.
    if (keyDebug.toLowerCase().includes('lock')) {
      throw new Error(
        'Your Lace wallet is locked. Click the Lace icon in your browser toolbar, ' +
          'enter your password to unlock it, then click "Seal & submit" again.',
      );
    }
    // Prefixed WALLET_DEBUG so the UI prints it verbatim (see friendlyError).
    throw new Error(
      `WALLET_DEBUG keys unresolved coin:${coinPublicKey.length} enc:${encryptionPublicKey.length} [${keyDebug}] shape=${describeShape(rawState)}`,
    );
  }

  // ── Adapt the Lace connector to the toolkit's provider interface ────────
  // Works with BOTH connector generations:
  //   • old Lace:  balanceAndProveTransaction + submitTransaction
  //   • new Lace (DUST): balanceSealedTransaction / balanceUnsealedTransaction
  //     + submitTransaction. Our tx is already contract-proven by proofProvider
  //     (submitTxCore proves before balancing), so we try the "sealed" balancer
  //     first. Every unknown path throws a verbatim WALLET_DEBUG diagnostic.
  const laceApi = walletApiLive as any;
  // Capture the wallet's returned tx id the moment submitTransaction resolves.
  // If a LATER step (the SDK's post-submit confirmation watch) then throws, we
  // still know the transaction was broadcast — the try/catch around the call
  // below turns that into a submitted result instead of a hard failure.
  let submittedTxId: string | null = null;
  // Which step we last reached, so a failure can name it in the banner.
  let reached = 'start';
  const laceProvider = {
    getCoinPublicKey() {
      return coinPublicKey;
    },
    getEncryptionPublicKey() {
      return encryptionPublicKey;
    },
    async balanceTx(tx: any) {
      // Old Lace: one call balances + fee-proves, and it accepts the live tx.
      if (typeof laceApi.balanceAndProveTransaction === 'function') {
        return laceApi.balanceAndProveTransaction(tx);
      }
      // New (DUST) Lace. A CONTRACT-CALL result is an UNSEALED (unbound) proven
      // transaction; the dApp-connector spec balances it with
      // `balanceUnsealedTransaction`, which adds the fee/dust inputs AND seals
      // (binds → pedersen-schnorr) the tx, then returns `{ tx }`. Lace pops one
      // approval dialog (for the fee) during this call.
      //
      // The tx must be SERIALIZED to cross the extension boundary: a live
      // wasm-bindgen object ({__wbg_ptr}) is rejected outright ("first argument
      // must be … string, Buffer, …"), while the serialized BYTES deserialize
      // and are accepted. Call it EXACTLY ONCE — each call prompts the user, so
      // looping over encodings fires several popups and trips "user rejected".
      const method = 'balanceUnsealedTransaction';
      if (typeof laceApi[method] !== 'function') {
        throw new Error(`WALLET_DEBUG wallet has no ${method} (fns: ${fnNames(laceApi)})`);
      }
      if (typeof tx?.serialize !== 'function') {
        throw new Error(`WALLET_DEBUG cannot serialize tx (proto: [${protoNames(tx)}])`);
      }
      // Pass the serialized bytes and let the wallet's own error propagate
      // unwrapped, so friendlyError can map it (e.g. "User rejected transaction"
      // → approve-the-popup guidance) instead of burying it in a debug dump.
      const bytes = tx.serialize();
      reached = 'balancing (wallet fee approval)';
      console.log('[ProofAudit] balanceTx → balanceUnsealedTransaction,', bytes?.length ?? '?', 'bytes');
      let balanced: any;
      try {
        balanced = await laceApi[method](bytes);
      } catch (e: any) {
        // Log the raw Effect error object so its full cause tree is expandable
        // in DevTools even if the banner text is truncated.
        console.error('[ProofAudit] balanceUnsealedTransaction raw error:', e);
        throw new Error(`WALLET_DEBUG balanceUnsealedTransaction failed: ${describeErr(e)}`, {
          cause: e,
        });
      }
      reached = 'balanced';
      console.log('[ProofAudit] balanceTx ← balanced OK');
      // Spec: returns `{ tx }`; some builds return the balanced tx directly.
      return balanced?.tx ?? balanced;
    },
    async submitTx(tx: any) {
      const submit =
        typeof laceApi.submitTransaction === 'function'
          ? laceApi.submitTransaction.bind(laceApi)
          : typeof laceApi.submitTx === 'function'
            ? laceApi.submitTx.bind(laceApi)
            : null;
      if (!submit) throw new Error(`WALLET_DEBUG no submit method fns=[${fnNames(laceApi)}]`);
      reached = 'submitting (broadcast to node)';
      console.log('[ProofAudit] submitTx → broadcasting to node…');
      let txId: any;
      try {
        txId = await submit(tx);
      } catch (e: any) {
        throw new Error(`WALLET_DEBUG submitTransaction failed: ${describeErr(e)}`, { cause: e });
      }
      submittedTxId =
        typeof txId === 'string'
          ? txId
          : txId?.txId ?? txId?.txHash ?? (txId != null ? String(txId) : null);
      reached = 'broadcast';
      console.log('[ProofAudit] submitTx ← broadcast OK, txId:', submittedTxId);
      return txId;
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

  // Mirror the circuit's own rule for an immediate verdict; the authoritative
  // value can be read back from the chain via the Verify tab.
  const passed =
    severityThreshold > 0n &&
    findings[0] < severityThreshold &&
    findings[1] < severityThreshold &&
    findings[2] < severityThreshold;

  // `findings` is the PRIVATE WITNESS: it is used only to build the local proof
  // and never appears on-chain. The chain records only the pass/fail verdict.
  reached = 'proving (proof server :6300)';
  let result: any;
  try {
    result = await (deployed as any).callTx.submitAttestation(
      contractHash,
      severityThreshold,
      findings,
    );
  } catch (err: any) {
    // A CallTxFailedError means the node INCLUDED the tx but the chain rejected
    // it (verdict/assertion) — that is a real failure, never mask it.
    const rejectedOnChain = err?.name === 'CallTxFailedError' || err?.finalizedTxData != null;
    // Otherwise, once our submitTx completed the tx WAS broadcast to the node
    // (reached === 'broadcast'), whether or not the wallet handed back a tx id —
    // the newer DUST-model Lace resolves submitTransaction with no id. Anything
    // thrown AFTER that is the SDK's post-broadcast confirmation watch: an indexer
    // query that the current Preview indexer rejects with
    // "IndexerQueryError / CombinedGraphQLErrors: Invalid value for argument
    // 'offset' … Oneof input objects requires have exactly one field". That watch
    // failing does NOT change whether the attestation lands, so we treat a
    // broadcast tx as submitted and let the Verify tab read the authoritative
    // on-chain verdict once the indexer catches up.
    const broadcast = submittedTxId != null || reached === 'broadcast';
    if (broadcast && !rejectedOnChain) {
      console.warn('[ProofAudit] post-broadcast confirmation watch failed — treating as submitted:', err);
      return { passed, txId: submittedTxId ?? 'submitted', contractHashHex: bytesToHex(contractHash) };
    }
    // Nothing was broadcast. Surface WHERE it died plus the real, de-wrapped
    // reason — the SDK hides it on err.cause with an empty message, so we walk
    // both. WALLET_DEBUG makes the UI print this verbatim, not the blank "Error".
    console.error('[ProofAudit] submitAttestation failed:', err, '\n  cause:', err?.cause);
    if (rejectedOnChain) throw err;
    throw new Error(
      `WALLET_DEBUG submit failed at [${reached}]: ${describeErr(err)}` +
        (err?.cause ? ` | cause: ${describeErr(err.cause)}` : ''),
    );
  }

  return {
    passed,
    txId:
      result?.public?.txId ||
      result?.txId ||
      result?.public?.txHash ||
      result?.deployTxData?.public?.txId ||
      submittedTxId ||
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
