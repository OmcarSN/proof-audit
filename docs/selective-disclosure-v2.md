# ProofAudit v2 — Selective Disclosure

> Design sketch only. Nothing here touches the deployed Preview contract, `managed/`,
> `deploy/`, or `tests/`. It's a blueprint for the version worth building past the hackathon.

## The one idea that changes everything

**v1 hides the findings. v2 *commits* to them.**

In v1, `findings` is an ephemeral private witness — it exists only while the proof is
generated, then it's gone. There is nothing on-chain to open later, so "selective
disclosure" is impossible by construction, and a `PASS` is indistinguishable from
"auditor typed zero findings."

In v2 the attestation stores a **binding, hiding commitment** to the full finding set
(a Merkle root). That single change unlocks three things:

1. The verdict is **provably derived** from the committed set — not merely asserted.
2. A public **severity histogram** ("0 critical · 0 high · 2 medium · 4 low") can be
   revealed and *proven consistent* with the sealed set — an honest signal that reveals
   nothing exploitable.
3. Any single finding (or a predicate over it) can be **selectively disclosed later** to
   a specific party — an insurer, acquirer, or regulator — with a membership proof against
   the on-chain root. This is the Midnight-native superpower and the actual product.

---

## Data model

```compact
// Richer than "exactly 3 severities"
struct Finding {
  id:         Bytes<32>;   // stable id (e.g. hash of title)
  severity:   Uint<8>;     // 1 Info · 2 Low · 3 Medium · 4 High/Critical
  category:   Uint<8>;     // optional taxonomy code
  status:     Uint<8>;     // 1 open · 2 acknowledged · 3 fixed · 4 wont-fix
  detailHash: Bytes<32>;   // hash of the full write-up (kept off-chain)
}

// Reproducible artifact reference — replaces free-text hashing
struct Artifact {
  chainId:  Uint<32>;      // eip155 chain id, or a code-registry id
  codeHash: Bytes<32>;     // canonical bytecode / build hash
  buildRef: Bytes<32>;     // hash of build metadata (compiler ver, settings)
}

// What lives on-chain per attestation
struct Attestation {
  auditor:     Bytes<32>;  // auditor public key (identity anchor)
  root:        Bytes<32>;  // Merkle root over the sealed findings
  count:       Uint<16>;   // number of findings (public)
  histogram:   Vector<4, Uint<16>>; // counts per severity (public, proven)
  passed:      Boolean;
  threshold:   Uint<8>;
  timestamp:   Uint<64>;
  prevRoot:    Bytes<32>;  // links a re-audit to its predecessor (0 if first)
}
```

## Ledger state

```compact
export ledger auditors:     Map<Bytes<32>, Bytes<32>>;      // pubkey -> name commitment
export ledger attestations: Map<Bytes<32>, Attestation>;    // artifactId -> attestation
```

`artifactId = persistentHash(Artifact)` — reproducible, so a verifier who has the same
build gets the same key. No more free-text hash guessing.

---

## Circuits

### 1. `submitAttestation` — seal + prove the verdict

```compact
export circuit submitAttestation(
  artifact:  Artifact,
  threshold: Uint<8>,
  findings:  Vector<MAX, Finding>,   // private
  salts:     Vector<MAX, Bytes<32>>, // private, per-finding blinding
  count:     Uint<16>,
  sig:       Signature               // over (artifactId, root, verdict, ts)
): [] {
  const artifactId = persistentHash<Artifact>(artifact);

  // 1. Build the commitment: leaf_i = hash(finding_i || salt_i); root over leaves.
  const root = merkleRoot(findings, salts, count);

  // 2. Derive the verdict from the PRIVATE findings — can't be faked.
  const worst = maxOpenSeverity(findings, count);
  const passed = worst < threshold;

  // 3. Public histogram must match the private set (the honesty check).
  const hist = severityHistogram(findings, count);

  // 4. Bind an auditor identity: signature verifies against a registered key.
  const auditor = recoverPubKey(sig, artifactId, root, passed, threshold);
  assert(auditors.member(disclose(auditor)), "unknown auditor");

  // disclose() marks exactly what leaves privacy -> ledger. Everything else stays sealed.
  attestations.insert(disclose(artifactId), Attestation {
    auditor:   disclose(auditor),
    root:      disclose(root),
    count:     disclose(count),
    histogram: disclose(hist),
    passed:    disclose(passed),
    threshold: disclose(threshold),
    timestamp: disclose(now()),
    prevRoot:  0,
  });
}
```

The `disclose(...)` calls are the whole thesis made explicit in code: the verdict,
histogram, auditor, and root become public; the findings and salts never do.

### 2. `discloseFinding` — the selective-disclosure payoff

```compact
// Prove a specific finding is a member of a sealed audit, revealing only what you choose.
export circuit discloseFinding(
  artifactId: Bytes<32>,
  finding:    Finding,        // private
  salt:       Bytes<32>,      // private
  path:       MerklePath,     // private
  reveal:     RevealMask      // which fields to make public
): DisclosedFinding {
  const att = attestations.lookup(artifactId);
  const leaf = hash(finding, salt);
  assert(verifyPath(path, leaf, att.root), "not a member of this audit");
  return applyMask(finding, reveal);   // e.g. reveal severity+status, keep detailHash sealed
}
```

Recipients verify this proof against the on-chain `root` — no need to trust the discloser.
Variants over the same commitment:
- **Predicate proofs:** "no *open* finding has severity ≥ High" — a global guarantee, zero findings revealed.
- **Status proofs:** "finding #2 is now `fixed`."

### 3. `attestFix` — model the real audit lifecycle

Re-attest after fixes: new root + verdict, with `prevRoot` chaining to the prior one.
Solves the "frozen forever verdict" problem — the chain shows *audit → fixes → clean re-audit*.

---

## Trust model: before vs. after

| Question | v1 | v2 |
|---|---|---|
| Who attested? | anonymous wallet | signed, registered auditor key |
| Is the verdict tied to real findings? | no — asserted | yes — derived in-circuit from the committed set |
| Can "PASS with 0 hidden findings" be detected? | no | yes — count + histogram are public and proven |
| What did they audit? | free-text hash | reproducible `artifactId` (chain + codeHash + build) |
| Can a specific finding be proven later? | impossible | yes — Merkle membership proof |
| Does it match how audits are consumed? | frozen verdict | re-attestation lifecycle |

---

## UI changes — three modes

**Attest (upgraded).** Structured artifact inputs (chain + address/upload → `codeHash`)
instead of free text; a real add/remove findings list (severity · category · status ·
detail, detail hashed locally); "attesting as [auditor]" from the connected key.
Two new must-haves:
- A **disclosure preview** before submit — a split panel showing exactly what goes
  *public* (verdict, histogram, auditor, artifact) vs. what stays *sealed* (each finding's
  content). This is a killer trust moment and pure on-theme for the dossier.
- A **downloaded audit keyfile** (encrypted findings + salts + Merkle data). Without it,
  nothing can ever be disclosed later — so saving it is part of the submit flow.

**Verify (upgraded).** `artifactId` → verdict **+ histogram + auditor identity +
timestamp + "N findings sealed."** Genuinely informative now, not a bare stamp.

**Disclose (new).** Load the keyfile → pick finding(s) or a predicate → pick recipient/purpose
→ generate a disclosure proof (file/link). Plus a **"Check a disclosure"** view: paste a
proof + `artifactId` → verifies membership against the on-chain root → shows the revealed
finding. *This* is the demo that lands with judges and investors.

---

## Scope, phasing, and risks (honest)

This is a **real contract redesign + ZK recompile + redeploy** — days, not hours. Stage it:

- **Phase 1 (biggest trust win, cheapest):** auditor identity + signature, structured
  `artifactId`, and the public severity histogram. No Merkle tree yet — just hash the set.
  This alone lifts the "real product" score substantially.
- **Phase 2 (the superpower):** Merkle commitment + `discloseFinding` + the Disclose UI.
- **Phase 3:** `attestFix` lifecycle, auditor reputation/staking in the registry.

Risks to validate first:
- **Merkle + hashing API:** confirm the exact `MerkleTree`/commitment/`persistentHash`
  primitives and signature support in *your* Compact stdlib version before committing to
  the circuit shape above (names here are illustrative).
- **Keyfile custody:** losing the opening data means permanent inability to disclose —
  treat it as a first-class, encrypted, backed-up artifact with clear UX warnings.
- **Circuit cost:** Merkle-path verification and signature recovery add proving time;
  budget for it and keep `MAX` findings bounded.
```
