# 🛡️ ProofAudit

**Privacy-Preserving Smart Contract Audit Attestation on Midnight**

ProofAudit lets a security reviewer prove that code was audited and has zero findings above a chosen severity threshold — without revealing the underlying vulnerability details. Built on [Midnight](https://midnight.network) using zero-knowledge proofs.

## Live Demo

[Deployed URL — add after Vercel deploy]

## Contract Address

| Network | Address |
|---------|---------|
| Preview | `33eaac85c9dd6b17f0d6ce38271bea626a4359d6a1c8b37ba3cb2c2af238e25a` |

## What This Does

An auditor submits an attestation containing:
- **Public (on-chain):** The contract hash being audited, the severity threshold used, and whether it passed
- **Private (never on-chain):** The actual audit findings — severity levels of each vulnerability found

The Midnight ZK circuit proves the relationship between the private findings and the public pass/fail result, without ever revealing what was found.

## Privacy Model

### What an on-chain observer CAN see:
- That a specific contract hash was attested
- The severity threshold that was applied (1-4)
- Whether the audit **passed** or **failed**

### What an on-chain observer CANNOT see:
- How many findings existed
- The severity of individual findings
- Any description of what was found

## Privacy Claim

> An observer can see that this contract was attested and whether it passed — they cannot see how many findings existed, their severity, or any description of what was found.

## Tech Stack

- **Smart Contract:** [Compact](https://docs.midnight.network) (pragma 0.23)
- **Runtime:** Midnight Network (Preview Testnet)
- **Frontend:** React 18 + Vite 5 + TypeScript
- **Wallet:** Lace (Midnight DApp Connector)
- **ZK Proofs:** Generated locally via Docker proof server

## Prerequisites

- Node.js v22
- Docker Desktop (for the proof server)
- [Lace wallet](https://lace.io) browser extension (configured for Midnight)

## Setup

```bash
# Install dependencies
npm install

# Start the proof server (Docker)
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0

# Run the frontend dev server
npm run dev

# Run tests
npm test
```

## Run Tests

```bash
npm test
```

Three test cases verify the circuit logic:
1. ✅ Passing case — all findings below threshold
2. ✅ Failing case — finding at/above threshold
3. ✅ Privacy check — findings never appear in public outputs

## Project Structure

```
proof-audit/
├── contracts/proof_audit.compact     — ZK smart contract (Compact)
├── managed/                          — Compiled contract artifacts
├── deploy/                           — Deployment scripts (Preview/Preprod)
├── src/
│   ├── components/
│   │   ├── WalletConnect.tsx         — Lace connect/disconnect
│   │   └── AttestationCall.tsx       — Circuit call + privacy display
│   ├── hooks/useMidnight.ts          — Wallet connection hook
│   ├── midnight/
│   │   ├── connector.ts             — DApp connector wrapper
│   │   └── contract.ts              — Circuit call logic
│   ├── config/network.ts            — Network endpoints
│   ├── App.tsx                      — Main app layout
│   ├── main.tsx                     — Entry point
│   └── styles.css                   — Dark theme styles
├── tests/proof_audit.test.ts         — Unit tests (3/3 passing)
├── deployment.preview.json           — Deployed contract info
└── vite.config.ts                    — Vite build configuration
```

## Initial Idea

Traditional smart contract audits produce reports that are either fully public (exposing vulnerabilities before they're fixed) or fully private (requiring trust in the auditor's claims). ProofAudit uses zero-knowledge proofs to create a middle ground: publicly verifiable attestations that prove an audit was conducted to a certain standard, without revealing what was found.

## Screenshots

[Add screenshots of wallet connection + attestation submission]
