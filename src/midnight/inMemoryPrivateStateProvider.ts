// ═══════════════════════════════════════════════════════════════════════
// In-memory private-state provider
//
// The stock @midnight-ntwrk/midnight-js-level-private-state-provider persists
// private state to IndexedDB through the `level` / `abstract-level` packages.
// Their browser builds define a `class … extends …` whose base class resolves
// to `undefined` once Vite/esbuild pre-bundles them, so merely importing that
// provider throws "Class extends value undefined is not a constructor or null"
// in the browser — before an attestation can ever be submitted.
//
// ProofAudit's contract declares NO witnesses and its private state is empty
// ({}), so durable private-state storage buys us nothing. This drop-in keeps
// everything in plain in-memory Maps: it satisfies the PrivateStateProvider
// interface the toolkit calls during a submit (setContractAddress / get / set /
// getSigningKey / setSigningKey …) with none of the problematic native/`level`
// dependencies. State lives for the page session — all a single submit needs.
// ═══════════════════════════════════════════════════════════════════════

import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

/**
 * Build a dependency-free, in-memory {@link PrivateStateProvider}. Suitable
 * for a contract with empty private state and no witnesses (see file header).
 */
export function inMemoryPrivateStateProvider<
  PSI extends string = string,
  PS = unknown,
>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<string, PS>();
  const signingKeys = new Map<string, unknown>();

  // Export/import are explicit user actions, never part of a submit. Stub them
  // so the interface shape is complete without pulling in encryption machinery.
  const unsupported = (op: string): never => {
    throw new Error(`inMemoryPrivateStateProvider: ${op} is not supported`);
  };

  return {
    // Address scoping is a no-op: this single-contract flow needs no isolation.
    setContractAddress() {},

    async set(privateStateId, state) {
      states.set(privateStateId, state);
    },
    async get(privateStateId) {
      const value = states.get(privateStateId);
      return value === undefined ? null : value;
    },
    async remove(privateStateId) {
      states.delete(privateStateId);
    },
    async clear() {
      states.clear();
    },

    async setSigningKey(address, signingKey) {
      signingKeys.set(String(address), signingKey);
    },
    async getSigningKey(address) {
      const value = signingKeys.get(String(address));
      return value === undefined ? null : (value as never);
    },
    async removeSigningKey(address) {
      signingKeys.delete(String(address));
    },
    async clearSigningKeys() {
      signingKeys.clear();
    },

    async exportPrivateStates() {
      return unsupported('exportPrivateStates');
    },
    async importPrivateStates() {
      return unsupported('importPrivateStates');
    },
    async exportSigningKeys() {
      return unsupported('exportSigningKeys');
    },
    async importSigningKeys() {
      return unsupported('importSigningKeys');
    },
  };
}
