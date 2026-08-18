# Product Proposal — ProofAudit

**Challenge idea:** Age / Eligibility Gate — *prove a threshold without revealing the underlying value.*

**Live demo:** https://proof-audit.vercel.app
**Contract (Midnight Preview):** `33eaac85c9dd6b17f0d6ce38271bea626a4359d6a1c8b37ba3cb2c2af238e25a`

---

## The problem

A smart-contract audit produces two things people care about: a **verdict** ("is this code clean enough to trust?") and the **findings** that back it up. Today you get one or the other:

- **Fully public reports** expose every vulnerability — often before it is fixed, handing attackers a map.
- **Fully private reports** ask everyone to just trust the auditor's word.

Neither is good. What a user actually wants is the *verdict they can check themselves*, without the sensitive details leaking.

## Why this is an Eligibility Gate

An eligibility gate proves that some hidden value clears a bar, while keeping the value secret. The classic example is age: prove you are over 18 without revealing your birth date.

ProofAudit is the same shape, applied to security audits:

| Eligibility Gate | ProofAudit |
|------------------|------------|
| The hidden value | The audit **findings** (severity of each issue) |
| The bar / threshold | The chosen **severity threshold** |
| What you prove | Every finding is **below** the threshold |
| What stays secret | The findings — how many, how severe, what they were |
| What becomes public | Only **pass / fail**, the threshold, and *which* code was audited |

So instead of "prove your age is over the bar without showing your age," ProofAudit proves "every finding is under the severity bar without showing the findings." Same privacy guarantee, real-world use case.

## How it works

1. The auditor enters *what they audited* (a name, code, or a file). The app hashes it locally into a 32-byte fingerprint (SHA-256, in the browser).
2. They pick a **severity threshold** and enter the finding severities. The findings are a **private witness** — used only to build the proof, they never leave the machine.
3. A zero-knowledge proof is generated locally (Docker proof server), Lace signs it, and the transaction is submitted.
4. On-chain, only the fingerprint, the threshold, and the **pass/fail verdict** are stored. Anyone can read that verdict back on the **Verify** tab with no wallet — while the findings are provably absent.

## Privacy model

**An observer CAN see:** that a specific contract fingerprint was attested, the severity threshold used, and whether it passed or failed.

**An observer CANNOT see:** how many findings existed, the severity of any individual finding, or any description of what was found.

That gap between what is proven and what is revealed *is* the product.

## Who it's for

Smart-contract auditors and audit firms, plus the people who depend on their verdicts — DeFi protocols, token teams, and the communities deciding whether a contract is safe to trust.

## Why Midnight specifically

ProofAudit needs two things at the same time that only a privacy-enabled chain can provide:

1. **A public, tamper-proof verdict** anyone can check — so it has to live on-chain.
2. **The evidence behind that verdict kept secret** — findings must not be published before they are fixed.

On a normal (transparent) chain you cannot have both: everything you put on-chain is public, so proving "all findings are below the bar" would force you to reveal the findings themselves. Midnight's zero-knowledge model is exactly what lets the findings stay a **private witness** while only the pass/fail verdict is disclosed. The product *is* that gap — it isn't achievable on Ethereum or other transparent L1s without bolting on a separate ZK stack.

## Data model

**On-chain (public)** — stored in the ledger as `attestations: Map<Bytes<32>, Attestation>`:

| Field | Type | Meaning |
|---|---|---|
| `contractHash` | `Bytes<32>` | Fingerprint of the audited code (the map key) |
| `severityThreshold` | `Uint<8>` | The bar that was applied |
| `passed` | `Boolean` | The verdict |
| `timestamp` | `Uint<64>` | When it was attested |

**Private witness (never on-chain):**

| Field | Type | Meaning |
|---|---|---|
| `findings` | `[Uint<8>, Uint<8>, Uint<8>]` | Severity of each issue found — used only inside the circuit to compute `passed`, never disclosed |

The circuit's `disclose(...)` calls are the only values that ever leave the prover; everything else stays secret by construction.

## Path to Mainnet (feasibility by Level 6)

The core already works and is deployed on testnet, so the road to Mainnet is about hardening, not inventing:

- **Levels 4-5:** lift the fixed "exactly 3 findings" limit to a variable count (a Merkle-committed findings list), add an auditor identity/credential so verdicts are attributable, and build a public registry UI to browse attestations.
- **Level 6:** security review of the circuit, proof-cost tuning, and deploy the audited contract to Mainnet.

Nothing on this roadmap needs a capability Midnight doesn't already have — it's the same primitives (private witness + selective disclosure + on-chain map) at larger scale — which makes a Mainnet deployment by Level 6 realistic.

## Status against the Level 3 bar

- ✅ **Functional dApp** meaningfully using Midnight's privacy model (private witness + public verdict), deployed and live on Preview.
- ✅ **Tests:** 3 passing (`npm test`) — passing case, failing case, and a privacy check that findings never appear in public output.
- ✅ **CI/CD:** GitHub Actions builds the web app and runs the tests on every push and PR to `main`.
- ✅ **Idea from the list:** Eligibility Gate (this document).
- ✅ **Commits:** well past the 10-commit minimum.
- ✅ **Public repo + README + live demo + privacy-model section.**

## Known limitations (surfaced honestly)

- The Level-1 contract attests to **exactly 3 findings**; a real audit has any number. Supporting a variable count needs a contract change and redeploy — flagged as a follow-up.
- Threshold **1** always fails, since no finding can sit below severity 1. The UI notes this.
- Shipped on **Preview**. A Preprod deploy was attempted but blocked upstream by a Midnight-side dust-proof error (`170`); the identical stack deploys cleanly to Preview.
