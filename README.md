# 🛡️ ProofAudit

**Prove a smart contract passed its security audit — without revealing what the auditor found.**

[![CI](https://github.com/OmcarSN/proof-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/OmcarSN/proof-audit/actions/workflows/ci.yml)

Built on [Midnight](https://midnight.network) using zero-knowledge proofs.

---

## 🔗 Quick Links

| | |
|---|---|
| 🌐 **Live app** | **[proof-audit.vercel.app](https://proof-audit.vercel.app/)** |
| 📺 **1-minute demo** | **[Watch on YouTube ↗](https://youtu.be/Fl0GRoSggFs)** |
| 📄 **Full idea write-up** | [PROPOSAL.md](PROPOSAL.md) |
| ⛓️ **Contract (Midnight Preprod)** | `9cf5ec73a7330def5f7730569d0b898572d5fdde78863ddb14f0f451493f117d` |

---

## 💡 The Idea in Plain English

Think about proving you're over 18 to get into a club. You show your ID… but that ID also reveals your exact birth date, your address, and your full name — far more than the bouncer needs. All they *actually* need to know is one thing: **"is this person over 18?"** — yes or no.

A **zero-knowledge proof** lets you answer exactly that one question — *"yes, I'm over 18"* — **without showing the birth date behind it.**

**ProofAudit applies the same trick to security audits.**

When someone audits a smart contract, they find bugs of different severity levels. Normally they face a bad choice:

- **Publish the full report** → everyone (including attackers) sees every unfixed vulnerability. 🔓
- **Keep it private** → you just have to *trust* the auditor's word. 🤷

ProofAudit offers a third option. The auditor proves a simple statement on-chain:

> **"I audited this exact code, and every issue I found is below the severity bar."**

Anyone can verify that statement is true. But the actual findings — how many bugs, how bad, what they were — **stay secret forever.** You get a verdict you can trust *and* check yourself, with nothing sensitive leaking.

### Same shape as the "age gate"

| | The "over 18" gate | ProofAudit |
|---|---|---|
| **Hidden value** | Your birth date | The audit **findings** (severity of each issue) |
| **The bar** | Age 18 | The chosen **severity threshold** |
| **What you prove** | You're over the bar | Every finding is **below** the bar |
| **What stays secret** | Your exact birth date | The findings — how many, how bad, what they were |
| **What becomes public** | Just "yes, over 18" | Just **pass / fail** + which code was checked |

This is the **Eligibility Gate** challenge idea: *prove a value clears a threshold without revealing the value.* See [PROPOSAL.md](PROPOSAL.md) for the full write-up.

---

## ⚙️ How It Works

The app has two tabs.

### 📝 Attest — create a sealed attestation
1. **Connect** your Lace wallet.
2. **Enter what you audited** — a name, pasted code, or a file. The app turns it into a unique 32-byte fingerprint (SHA-256), right in your browser.
3. **Pick a severity threshold** — the audit passes only if *every* finding is below it.
4. **Enter the finding severities.** These are the **private witness** — they build the proof locally and **never leave your machine**.
5. **Submit.** A zero-knowledge proof is generated locally, Lace signs it, and the transaction goes on-chain. Only the fingerprint, the threshold, and the **pass/fail verdict** are stored.

### 🔍 Verify — read a verdict from the chain
1. Enter the **same** thing that was audited, to reproduce the fingerprint.
2. The app reads the attestation straight from the chain (**no wallet, no proof server needed**) and shows **PASSED / FAILED + threshold** — while the findings are visibly absent.

That gap — between what's *proven* and what's *revealed* — is the whole product.

---

## 🔒 Privacy Model

| ✅ An observer **CAN** see | ❌ An observer **CANNOT** see |
|---|---|
| That a specific contract fingerprint was attested | How many findings existed |
| The severity threshold applied (1–4) | The severity of any individual finding |
| Whether it **passed** or **failed** | Any description of what was found |

> **Privacy claim:** An observer can see that this contract was attested and whether it passed — they can never see how many findings existed, their severity, or what they were.

---

## 🚀 Try It Yourself

**Just want to verify a verdict?** Open **[the live app](https://proof-audit.vercel.app/)** → **Verify** tab. No wallet or setup needed — it reads directly from the chain.

**Want to create an attestation?** You'll need:
- The [Lace wallet](https://lace.io) extension, set to **Midnight Preprod**, funded with test **tNIGHT** from the [Preprod faucet](https://faucet.preprod.midnight.network/).
- The local **proof server** running (see [Setup](#-local-setup) below).

> 💡 **Fees are paid in tDUST, not tNIGHT.** Holding tNIGHT alone isn't enough — in Lace, click **"Generate tDUST"** (Review → Confirm) once to register your NIGHT and start the DUST balance filling. This covers the transaction fee.

---

## 📜 The Smart Contract

Written in [Compact](https://docs.midnight.network) (`pragma 0.23`). The core logic is deliberately small — the privacy comes from *what it chooses to disclose*:

```compact
export circuit submitAttestation(
  contractHash: Bytes<32>,        // PUBLIC — which code was audited
  severityThreshold: Uint<8>,     // PUBLIC — the bar
  findings: [Uint<8>, Uint<8>, Uint<8>]  // PRIVATE witness — never touches the chain
): [] {
  // Passes only if EVERY finding is strictly below the threshold.
  const passed = (findings[0] < severityThreshold)
              && (findings[1] < severityThreshold)
              && (findings[2] < severityThreshold);

  // The ONE deliberate disclosure: the verdict, the hash, and the threshold.
  // `findings` is used in the proof but is never disclosed.
  attestations.insert(disclose(contractHash), Attestation {
    passed: disclose(passed),
    severityThreshold: disclose(severityThreshold),
    timestamp: 0 as Uint<64>
  });
}
```

The `findings` array is a **private witness**: the proof mathematically guarantees the verdict was computed from real findings, but the findings themselves never appear on-chain. Only the `disclose(...)` values do.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | [Compact](https://docs.midnight.network) (pragma 0.23) |
| Network | Midnight **Preprod** testnet |
| Frontend | React 18 + Vite 5 + TypeScript |
| Wallet | Lace (Midnight DApp Connector) |
| ZK proofs | Generated locally via the Docker proof server (`proof-server:8.1.0`) |
| On-chain reads | Indexer GraphQL API (no wallet or proof server needed) |
| CI/CD | GitHub Actions — builds the web app + runs tests on every push/PR |

---

## 💻 Local Setup

**Prerequisites:** Node.js v22 · Docker Desktop · [Lace wallet](https://lace.io) (Midnight Preview)

```bash
# 1. Install dependencies
npm install

# 2. Start the local proof server (generates ZK proofs)
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0

# 3. Run the app
npm run dev

# 4. Run the tests
npm test
```

---

## 🧪 Tests

```bash
npm test
```

Three tests verify the circuit logic (all passing ✅):
1. **Passing case** — all findings below the threshold → `passed = true`.
2. **Failing case** — a finding at/above the threshold → `passed = false`.
3. **Privacy check** — the findings never appear in the public output.

---

## 📁 Project Structure

```
proof-audit/
├── contracts/proof_audit.compact     — ZK smart contract (Compact)
├── managed/                          — Compiled contract artifacts + proving keys
├── deploy/                           — Deployment scripts (Preview/Preprod)
├── public/zk/                        — Proving keys + zkIR served to the browser
├── src/
│   ├── components/
│   │   ├── WalletConnect.tsx         — Lace connect/disconnect
│   │   ├── AttestationCall.tsx       — Attest flow (hashing, sealed findings, submit)
│   │   └── VerifyAttestation.tsx     — Verify flow (read public verdict from chain)
│   ├── hooks/useMidnight.ts          — Wallet connection hook
│   ├── midnight/
│   │   ├── connector.ts              — DApp connector wrapper
│   │   ├── contract.ts               — Circuit call (write) + on-chain read
│   │   └── zkConfigProvider.ts       — Fetches proving keys/zkIR from /zk
│   ├── lib/
│   │   ├── hash.ts                   — SHA-256 → 32-byte fingerprint
│   │   └── proofServer.ts            — Proof-server health check + docker hint
│   ├── shims/isomorphic-ws.ts        — Browser WebSocket shim (production build)
│   ├── config/network.ts             — Network endpoints (Preview/Preprod)
│   ├── App.tsx                       — Main layout + Attest/Verify tabs
│   ├── main.tsx                      — Entry point
│   └── styles.css                    — "Sealed dossier" design system
├── tests/proof_audit.test.ts         — Unit tests (3/3 passing)
├── deployment.preview.json           — Deployed contract info
└── vite.config.ts                    — Vite build configuration
```

---

## ⛓️ Deployment

The contract is deployed and live on **both Midnight testnets**. The app points at **Preprod**.

| Network | Address | Status |
|---------|---------|--------|
| **Preprod** (active) | `9cf5ec73a7330def5f7730569d0b898572d5fdde78863ddb14f0f451493f117d` | ✅ Live |
| Preview | `33eaac85c9dd6b17f0d6ce38271bea626a4359d6a1c8b37ba3cb2c2af238e25a` | ✅ Live |

> **Note on the Preprod deploy.** An early attempt was rejected by the Preprod node with `Invalid Transaction: Custom error: 170` (`InvalidDustSpendProof`) — a transient Midnight-side dust-proof issue. A later attempt, run after a full genesis dust sync, deployed cleanly with the **same** stack (`ledger-v8` 8.1.0 + `proof-server:8.1.0`). The deployment is verified on-chain: querying the Preprod indexer for the address returns a `ContractDeploy` action carrying the contract's `submitAttestation` / `getAttestation` circuits.

---

## ⚠️ Known Limitations (surfaced honestly)

- **Exactly 3 findings.** This contract attests to a fixed set of three finding severities. A real audit has any number; supporting that needs a contract change + redeploy — flagged as a follow-up.
- **Threshold "1" always fails**, since no finding can be below severity 1. The UI notes this and omits it as an option.

---

<p align="center">
<strong>ProofAudit</strong> — Midnight Builder Challenge · Eligibility Gate<br/>
<em>Findings are proven with zero-knowledge proofs and never revealed on-chain.</em>
</p>
