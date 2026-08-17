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
