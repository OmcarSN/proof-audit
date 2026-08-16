import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Attestation = { passed: boolean;
                            severityThreshold: bigint;
                            timestamp: bigint
                          };

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  submitAttestation(context: __compactRuntime.CircuitContext<PS>,
                    contractHash_0: Uint8Array,
                    severityThreshold_0: bigint,
                    findings_0: [bigint, bigint, bigint]): __compactRuntime.CircuitResults<PS, []>;
  getAttestation(context: __compactRuntime.CircuitContext<PS>,
                 contractHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, Attestation>;
}

export type ProvableCircuits<PS> = {
  submitAttestation(context: __compactRuntime.CircuitContext<PS>,
                    contractHash_0: Uint8Array,
                    severityThreshold_0: bigint,
                    findings_0: [bigint, bigint, bigint]): __compactRuntime.CircuitResults<PS, []>;
  getAttestation(context: __compactRuntime.CircuitContext<PS>,
                 contractHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, Attestation>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  submitAttestation(context: __compactRuntime.CircuitContext<PS>,
                    contractHash_0: Uint8Array,
                    severityThreshold_0: bigint,
                    findings_0: [bigint, bigint, bigint]): __compactRuntime.CircuitResults<PS, []>;
  getAttestation(context: __compactRuntime.CircuitContext<PS>,
                 contractHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, Attestation>;
}

export type Ledger = {
  attestations: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Attestation;
    [Symbol.iterator](): Iterator<[Uint8Array, Attestation]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
