import { useEffect, useState } from 'react';
import { readAttestation, type AttestationView } from '../midnight/contract';
import { sha256Text, sha256File, hexToBytes32, bytesToHex } from '../lib/hash';

type HashMode = 'friendly' | 'raw';
type LookupState = 'idle' | 'loading' | 'found' | 'notfound' | 'error';

function friendlyReadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  if (low.includes('fetch') || low.includes('network') || low.includes('indexer')) {
    return "Couldn't reach the network indexer. Check your connection and try again.";
  }
  return raw;
}

export function VerifyAttestation() {
  const [mode, setMode] = useState<HashMode>('friendly');
  const [subject, setSubject] = useState('');
  const [rawHex, setRawHex] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [hashBytes, setHashBytes] = useState<Uint8Array | null>(null);

  const [state, setState] = useState<LookupState>('idle');
  const [view, setView] = useState<AttestationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Friendly mode: derive the hash live from typed text (unless a file set it).
  useEffect(() => {
    if (mode !== 'friendly' || fileName) return;
    const text = subject.trim();
    if (!text) { setHashBytes(null); return; }
    let cancelled = false;
    void sha256Text(text).then((h) => { if (!cancelled) setHashBytes(h); });
    return () => { cancelled = true; };
  }, [subject, mode, fileName]);

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

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    let hb = hashBytes;
    if (mode === 'raw') {
      try { hb = hexToBytes32(rawHex); } catch (err) { setError(friendlyReadError(err)); setState('error'); return; }
    }
    if (!hb) {
      setError(mode === 'raw' ? 'Enter a 64-character hex hash.' : 'Enter what you want to verify first.');
      setState('error');
      return;
    }
    setState('loading');
    setError(null);
    setView(null);
    try {
      const v = await readAttestation(hb);
      if (!v) { setState('notfound'); }
      else { setView(v); setState('found'); }
    } catch (err) {
      setError(friendlyReadError(err));
      setState('error');
    }
  };

  const loading = state === 'loading';
  const hashHex = hashBytes ? bytesToHex(hashBytes) : '';

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="ico" aria-hidden="true">🔎</span>
        <h2>Verify an attestation</h2>
      </div>
      <p className="panel-intro">
        Look up any audited item on-chain. You'll see the verdict and the standard applied — but never the findings.
      </p>

      <form onSubmit={lookup}>
        <div className="field">
          <label className="field-label" htmlFor="verify-subject">
            What to verify
            <button type="button" className="linkbtn" onClick={() => setMode(mode === 'friendly' ? 'raw' : 'friendly')}>
              {mode === 'friendly' ? 'Advanced: paste raw hash' : 'Back to simple mode'}
            </button>
          </label>

          {mode === 'friendly' ? (
            <>
              <input
                id="verify-subject"
                className="input"
                type="text"
                placeholder="The same name, address, or source you attested"
                value={fileName ? `📄 ${fileName}` : subject}
                onChange={(e) => onSubjectChange(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
              <p className="field-help">
                Must match exactly what was attested — same text produces the same fingerprint.{' '}
                <label className="linkbtn" style={{ cursor: 'pointer' }}>
                  Hash a file instead
                  <input type="file" hidden onChange={onFile} disabled={loading} />
                </label>
              </p>
            </>
          ) : (
            <>
              <input
                id="verify-subject"
                className="input"
                type="text"
                placeholder="64-character hex hash (with or without 0x)"
                value={rawHex}
                onChange={(e) => setRawHex(e.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-help">Look up by the exact contract hash.</p>
            </>
          )}

          {hashHex && (
            <div className="hash-readout">
              <span>Fingerprint</span>
              <code>{hashHex}</code>
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-ghost btn-block" disabled={loading}>
          {loading ? (<><span className="spinner" /> Reading the chain…</>) : 'Look up verdict'}
        </button>
      </form>

      {state === 'found' && view && (
        <div className="verdict-card" style={{ marginTop: '1.5rem' }}>
          <div className={`stamp ${view.passed ? 'passed' : 'failed'}`}>
            {view.passed ? 'Passed' : 'Failed'}
          </div>
          <div style={{ marginTop: '1.4rem', textAlign: 'left' }}>
            <div className="verdict-line">
              <span className="k">Verdict</span>
              <span className={`v ${view.passed ? 'pass' : 'fail'}`}>{view.passed ? 'PASSED' : 'FAILED'}</span>
            </div>
            <div className="verdict-line">
              <span className="k">Pass standard</span>
              <span className="v">Below severity {view.severityThreshold}</span>
            </div>
            <div className="verdict-line">
              <span className="k">Findings</span>
              <span className="v absent">never on-chain</span>
            </div>
          </div>
          <p className="result-note" style={{ marginTop: '1.1rem' }}>
            🔒 You can see the verdict — not what was found.
          </p>
        </div>
      )}

      {state === 'notfound' && (
        <div className="banner banner-warn" role="status" style={{ marginTop: '1.25rem' }}>
          <div className="banner-title">No attestation found</div>
          <p>Nothing has been attested for this fingerprint yet. Double-check the input matches exactly what was submitted.</p>
        </div>
      )}

      {state === 'error' && error && (
        <div className="banner banner-err" role="alert" style={{ marginTop: '1.25rem' }}>
          <div className="banner-title">Couldn't look that up</div>
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}
