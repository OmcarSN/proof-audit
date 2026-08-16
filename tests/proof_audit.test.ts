import { describe, it, expect, beforeEach } from 'vitest';
import { Contract, ledger } from '../managed/contract/index.js';
import {
  emptyZswapLocalState,
  createCircuitContext
} from '@midnight-ntwrk/compact-runtime';
import {
  signatureVerifyingKey,
  sampleSigningKey,
  dummyContractAddress
} from '@midnight-ntwrk/onchain-runtime-v3';

// ─── Test Key ─────────────────────────
const TEST_COIN_PUBLIC_KEY = signatureVerifyingKey(sampleSigningKey());

// ─── Helper: Create Initial Contract + CircuitContext ──────────────────
function setupInitialState() {
  const contract = new Contract({});

  const constructorResult = contract.initialState(
    {
      initialPrivateState: {},
      initialZswapLocalState: emptyZswapLocalState(TEST_COIN_PUBLIC_KEY)
    }
  );

  const context = createCircuitContext(
    dummyContractAddress(),
    constructorResult.currentZswapLocalState.coinPublicKey,
    constructorResult.currentContractState,
    constructorResult.currentPrivateState
  );

  return { contract, context };
}

// ─── Helper: Read Ledger State from CircuitContext ─────────────────────
function readState(ctx: any) {
  return ledger(ctx.currentQueryContext.state);
}

// ═══════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════

describe('ProofAudit — Level 1', () => {
  it('TEST 1 — Circuit logic (passing case)', () => {
    const { contract, context } = setupInitialState();
    
    // threshold is 3. findings are 1, 2, 2. All below threshold.
    const findings: [bigint, bigint, bigint] = [1n, 2n, 2n];
    const contractHash = new Uint8Array(32);
    contractHash[31] = 0; // dummy hash

    const severityThreshold = 3n;
    
    const r = contract.impureCircuits.submitAttestation(context, contractHash, severityThreshold, findings);
    const state = readState(r.context);
    
    // Assert passed == true
    const attestation = state.attestations.lookup(contractHash);
    expect(attestation).toBeDefined();
    expect(attestation.passed).toBe(true);
  });

  it('TEST 2 — Circuit logic / state transition (failing case)', () => {
    const { contract, context } = setupInitialState();
    
    // threshold is 3. finding of 3 is at/above threshold.
    const findings: [bigint, bigint, bigint] = [1n, 3n, 1n];
    const contractHash = new Uint8Array(32);
    contractHash[31] = 1;
    const severityThreshold = 3n;
    
    const r = contract.impureCircuits.submitAttestation(context, contractHash, severityThreshold, findings);
    const state = readState(r.context);
    
    // Assert passed == false
    const attestation = state.attestations.lookup(contractHash);
    expect(attestation).toBeDefined();
    expect(attestation.passed).toBe(false);
  });

  it('TEST 3 — Privacy check (findings are not exposed)', () => {
    const { contract, context } = setupInitialState();
    
    const findings: [bigint, bigint, bigint] = [4n, 4n, 4n]; // highly sensitive findings
    const contractHash = new Uint8Array(32);
    contractHash[31] = 2;
    const severityThreshold = 3n;
    
    const r = contract.impureCircuits.submitAttestation(context, contractHash, severityThreshold, findings);
    
    // Inspect every public output/ledger state
    const state = readState(r.context);
    const attestation = state.attestations.lookup(contractHash);
    
    // Stringify the public state and return values to verify '4' is not present
    const publicStateStr = JSON.stringify(state, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    const returnValStr = JSON.stringify(r.result, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    
    expect(publicStateStr).not.toContain('4');
    expect(returnValStr).not.toContain('4');
    
    // Ensure only the boolean passed and the threshold are visible
    expect(attestation.severityThreshold).toBe(3n);
    expect(attestation.passed).toBe(false);
  });
});
