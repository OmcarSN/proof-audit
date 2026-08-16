import { useEffect, useState } from 'react';
import type { UseMidnight } from '../hooks/useMidnight';
import { callSubmitAttestation, type AttestationResult } from '../midnight/contract';
import { sha256Text, sha256File, hexToBytes32, bytesToHex } from '../lib/hash';
import { isProofServerUp, PROOF_SERVER_DOCKER_CMD } from '../lib/proofServer';
import { CONTRACT_ADDRESS, explorerTxUrl } from '../config/network';

interface Props {
  wallet: UseMidnight;
}

type CallState = 'idle' | 'proving' | 'success' | 'error';
type HashMode = 'friendly' | 'raw';

const SEVERITIES = [
  { v: 1, label: '1 · Info' },
  { v: 2, label: '2 · Low' },
  { v: 3, label: '3 · Medium' },
  { v: 4, label: '4 · Critical' },
];

// Threshold 1 is intentionally omitted: "passed" means every finding is
// strictly below the threshold, so a threshold of 1 can never pass.
const THRESHOLDS = [
  { v: 2, label: 'Low — fail on any Low finding or worse' },
  { v: 3, label: 'Medium — fail on any Medium finding or worse' },
  { v: 4, label: 'Critical — fail only on a Critical finding' },
];

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  if ((err as any)?.code === 4001 || low.includes('reject') || low.includes('denied')) {
    return 'The wallet request was dismissed. Approve the transaction in the Lace popup to submit.';
  }
  if (low.includes('6300') || low.includes('proof') || low.includes('econnrefused') || low.includes('failed to fetch')) {
    return "Couldn't reach the proof server on port 6300. Start it with Docker (see the note above), then try again.";
  }
  if (low.includes('insufficient') || low.includes('dust') || low.includes('funds') || low.includes('balance')) {
    return 'Your wallet needs Preview test funds (tDUST) to cover the transaction fee.';
  }
  return raw;
}

export function AttestationCall({ wallet }: Props) {
  const { connection } = wallet;
  const isConnected = wallet.status === 'connected' && !!connection;

  // What was audited → 32-byte hash
  const [mode, setMode] = useState<HashMode>('friendly');
  const [subject, setSubject] = useState('');
  const [rawHex, setRawHex] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [hashBytes, setHashBytes] = useState<Uint8Array | null>(null);

  // Audit inputs
  const [threshold, setThreshold] = useState(3);
  const [findings, setFindings] = useState<[number, number, number]>([1, 1, 1]);

  // Environment + call state
  const [proofUp, setProofUp] = useState<boolean | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [result, setResult] = useState<AttestationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Preflight: is the local proof server reachable?
  const recheckProofServer = () => {
    setProofUp(null);
    void isProofServerUp().then(setProofUp);
  };
  useEffect(() => { recheckProofServer(); }, []);

  // Friendly mode: derive the hash live from typed text (unless a file set it).
  useEffect(() => {
    if (mode !== 'friendly' || fileName) return;
    const text = subject.trim();
    if (!text) { setHashBytes(null); return; }
    let cancelled = false;
    void sha256Text(text).then((h) => { if (!cancelled) setHashBytes(h); });
    return () => { cancelled = true; };
  }, [subject, mode, fileName]);

  // Raw mode: parse the hex live (invalid → no hash yet, no scary error while typing).
  useEffect(() => {
    if (mode !== 'raw') return;
    try { setHashBytes(hexToBytes32(rawHex)); } catch { setHashBytes(null); }
  }, [rawHex, mode]);

  const onSubjectChange = (value: string) => {
    setFileName(null);
    setSubject(value);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSubject('');
    setFileName(f.name);
    setHashBytes(await sha256File(f));
  };

  const setFinding = (i: number, v: number) => {
    setFindings((prev) => {
      const next = [...prev] as [number, number, number];
      next[i] = v;
      return next;
    });
  };

  const useSample = () => {
    setMode('friendly');
    setFileName(null);
    setSubject('MyToken.sol @ 0xA1b2…c3d4');
    setThreshold(3);
    setFindings([1, 2, 1]);
  };

  const copyTx = async (txId: string) => {
    try {
      await navigator.clipboard.writeText(txId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be unavailable; ignore */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !connection) return;

    let hb = hashBytes;
    if (mode === 'raw') {
      try { hb = hexToBytes32(rawHex); } catch (err) { setError(friendlyError(err)); return; }
    }
    if (!hb) {
      setError(mode === 'raw' ? 'Enter a 64-character hex hash.' : 'Tell us what you audited first.');
      return;
    }

    setCallState('proving');
    setError(null);
    setResult(null);

    try {
      const res = await callSubmitAttestation(
        connection.api,
        connection.state,
        hb,
        BigInt(threshold),
        findings.map(BigInt) as [bigint, bigint, bigint],
      );
      setResult(res);
      setCallState('success');
      // Privacy: drop the entered findings from state once the proof is built.
      setFindings([1, 1, 1]);
    } catch (err) {
      setError(friendlyError(err));
      setCallState('error');
    }
  };

  const proving = callState === 'proving';
  const hashHex = hashBytes ? bytesToHex(hashBytes) : '';

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="ico" aria-hidden="true">📝</span>
        <h2>Create an attestation</h2>
      </div>
      <p className="panel-intro">
        Prove your audit's verdict on-chain. The findings build the proof locally and never leave your browser.
      </p>

      {proofUp === false && (
        <div className="banner banner-warn" role="status">
          <div className="banner-title">⚠️ Proof server not reachable</div>
          <p>ZK proofs are generated locally. Start the proof server, then re-check:</p>
          <pre className="code-block">{PROOF_SERVER_DOCKER_CMD}</pre>
          <div className="banner-actions">
            <button type="button" className="btn-icon" onClick={recheckProofServer}>Re-check</button>
          </div>
        </div>
      )}

      {!isConnected ? (
        <p className="muted">Connect your Lace wallet above to create an attestation.</p>
      ) : callState === 'success' && result ? (
        <div className="result">
          <div className={`stamp ${result.passed ? 'passed' : 'failed'}`}>
            {result.passed ? 'Passed' : 'Failed'}
          </div>
          <p className="result-note">🔒 Proven without revealing your findings.</p>
          <div className="tx-row">
            <code title={result.txId}>{result.txId}</code>
            <button type="button" className="btn-icon" onClick={() => copyTx(result.txId)}>
              {copied ? 'Copied' : 'Copy tx'}
            </button>
          </div>
          {explorerTxUrl(result.txId) && (
            <a className="linkbtn" href={explorerTxUrl(result.txId)!} target="_blank" rel="noopener">
              View on explorer ↗
            </a>
          )}
          <div className="result-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setCallState('idle'); setResult(null); }}
            >
              Create another
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {/* ── What was audited ─────────────────────────────── */}
          <div className="field">
            <label className="field-label" htmlFor="subject">
              What did you audit?
              <button type="button" className="linkbtn" onClick={() => setMode(mode === 'friendly' ? 'raw' : 'friendly')}>
                {mode === 'friendly' ? 'Advanced: paste raw hash' : 'Back to simple mode'}
              </button>
            </label>

            {mode === 'friendly' ? (
              <>
                <input
                  id="subject"
                  className="input"
                  type="text"
                  placeholder="A name, an address, or paste the source code"
                  value={fileName ? `📄 ${fileName}` : subject}
                  onChange={(e) => onSubjectChange(e.target.value)}
                  disabled={proving}
                  autoComplete="off"
                />
                <p className="field-help">
                  We turn this into a unique 32-byte fingerprint (SHA-256). Same input → same fingerprint.{' '}
                  <label className="linkbtn" style={{ cursor: 'pointer' }}>
                    Hash a file instead
                    <input type="file" hidden onChange={onFile} disabled={proving} />
                  </label>
                  {' · '}
                  <button type="button" className="linkbtn" onClick={useSample} disabled={proving}>Try a sample</button>
                </p>
              </>
            ) : (
              <>
                <input
                  id="subject"
                  className="input"
                  type="text"
                  placeholder="64-character hex hash (with or without 0x)"
                  value={rawHex}
                  onChange={(e) => setRawHex(e.target.value)}
                  disabled={proving}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="field-help">For when you already have the exact contract hash.</p>
              </>
            )}

            {hashHex && (
              <div className="hash-readout">
                <span>Fingerprint</span>
                <code>{hashHex}</code>
              </div>
            )}
          </div>

          {/* ── Threshold ────────────────────────────────────── */}
          <div className="field">
            <label className="field-label" htmlFor="threshold">Pass standard</label>
            <select
              id="threshold"
              className="input"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={proving}
            >
              {THRESHOLDS.map((t) => (
                <option key={t.v} value={t.v}>{t.label}</option>
              ))}
            </select>
            <p className="field-help">The audit passes only if every finding is below this severity.</p>
          </div>

          {/* ── Findings (private) ───────────────────────────── */}
          <div className="sealed">
            <div className="sealed-head">
              <span className="sealed-lock" aria-hidden="true">🔒</span>
              Findings
              <span className="sealed-tag">Stays on your device</span>
            </div>
            <div className="sealed-rows">
              {findings.map((val, i) => (
                <div className="finding-row" key={i}>
                  <span className="finding-idx">Finding {i + 1}</span>
                  <select
                    className="input"
                    aria-label={`Finding ${i + 1} severity`}
                    value={val}
                    onChange={(e) => setFinding(i, Number(e.target.value))}
                    disabled={proving}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s.v} value={s.v}>{s.label}</option>
                    ))}
                  </select>
                  <span className="redaction" aria-hidden="true" />
                </div>
              ))}
            </div>
            <p className="field-help">
              This Level-1 contract attests to exactly 3 findings. If you found fewer, set the extras to Info.
            </p>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={proving}>
            {proving ? (<><span className="spinner" /> Generating ZK proof…</>) : 'Seal & submit attestation'}
          </button>

          {proving && (
            <p className="proving-note">⏳ Building the zero-knowledge proof locally — this can take a few seconds.</p>
          )}

          {error && (
            <div className="banner banner-err" role="alert" style={{ marginTop: '1rem' }}>
              <div className="banner-title">Couldn't submit</div>
              <p>{error}</p>
              <div className="banner-actions">
                <button type="button" className="btn-icon" onClick={() => { setError(null); setCallState('idle'); }}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      <p className="field-help" style={{ marginTop: '1.25rem' }}>
        Contract <code style={{ fontFamily: 'var(--font-mono)' }}>{CONTRACT_ADDRESS.slice(0, 10)}…</code> on Preview.
      </p>
    </section>
  );
}
