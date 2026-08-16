// ═══════════════════════════════════════════════════════════════════════
// ProofAudit — Browser ZK config provider
//
// The Midnight toolkit ships a Node-only ZK config provider that reads the
// proving keys and compiled circuit from disk. A browser has no disk, so this
// is the browser twin: it fetches the same files over HTTP instead.
//
// It mirrors NodeZkConfigProvider exactly — same folders, same file
// extensions, same byte-branding factories:
//   keys/<circuit>.prover     — proving key
//   keys/<circuit>.verifier   — verifier key
//   zkir/<circuit>.bzkir      — compiled circuit (binary zkIR)
//
// Files are served from `baseURL` (see public/zk/), so with baseURL "/zk" it
// fetches "/zk/keys/submitAttestation.prover", and so on. This is the provider
// the contract-call path reads its ZK assets through.
// ═══════════════════════════════════════════════════════════════════════

import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  type ProverKey,
  type VerifierKey,
  type ZKIR,
} from '@midnight-ntwrk/midnight-js-types';

export class FetchZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  constructor(private readonly baseURL: string) {
    super();
  }

  private async fetchBytes(subDir: string, circuitId: K, ext: string): Promise<Uint8Array> {
    const url = `${this.baseURL}/${subDir}/${circuitId}${ext}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (cause) {
      throw new Error(`Could not reach ZK asset "${url}". Is the app serving /zk? (${String(cause)})`);
    }
    if (!res.ok) {
      throw new Error(
        `Missing ZK asset "${url}" (HTTP ${res.status}). Copy managed/keys and managed/zkir into public/zk.`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    return createProverKey(await this.fetchBytes('keys', circuitId, '.prover'));
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    return createVerifierKey(await this.fetchBytes('keys', circuitId, '.verifier'));
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    return createZKIR(await this.fetchBytes('zkir', circuitId, '.bzkir'));
  }
}
