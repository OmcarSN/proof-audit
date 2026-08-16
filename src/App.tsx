import { useState } from 'react';
import { useMidnight } from './hooks/useMidnight';
import { WalletConnect } from './components/WalletConnect';
import { AttestationCall } from './components/AttestationCall';
import { VerifyAttestation } from './components/VerifyAttestation';
import { CONTRACT_ADDRESS, ACTIVE_NETWORK } from './config/network';

type Tab = 'attest' | 'verify';

export function App() {
  const wallet = useMidnight();
  const [tab, setTab] = useState<Tab>('attest');

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-eyebrow">Zero-knowledge audit attestation</div>
        <h1 className="masthead-title">Proof<span className="mark">Audit</span></h1>
        <p className="masthead-sub">
          Prove an audit's verdict on Midnight — and keep every finding sealed.
        </p>
        <div className="masthead-meta">
          <span className="net-badge"><span className="dot" /> {ACTIVE_NETWORK}</span>
          <span className="addr">
            <span className="addr-label">contract</span> {CONTRACT_ADDRESS.slice(0, 10)}…{CONTRACT_ADDRESS.slice(-6)}
          </span>
        </div>
      </header>

      {/* Genuine 1→2→3 sequence, so the numbering carries real order. */}
      <section className="how-wrap" aria-label="How it works">
        <div className="how-eyebrow">How it works</div>
        <ol className="how">
          <li className="how-step">
            <span className="how-num">01</span>
            <div className="how-body">
              <span className="how-title">Enter what you audited</span>
              <span className="how-desc">Name the target or paste the code, and log the severities you found. Findings stay in your browser.</span>
            </div>
          </li>
          <li className="how-step">
            <span className="how-num">02</span>
            <div className="how-body">
              <span className="how-title">Prove it locally</span>
              <span className="how-desc">A zero-knowledge proof is generated on your machine, then submitted through Lace.</span>
            </div>
          </li>
          <li className="how-step">
            <span className="how-num">03</span>
            <div className="how-body">
              <span className="how-title">Anyone can verify</span>
              <span className="how-desc">The pass or fail becomes public. The findings behind it never do.</span>
            </div>
          </li>
        </ol>
      </section>

      <main>
        <WalletConnect wallet={wallet} />

        <nav className="tabs" role="tablist" aria-label="Actions">
          <button
            role="tab"
            aria-selected={tab === 'attest'}
            className={`tab ${tab === 'attest' ? 'is-active' : ''}`}
            onClick={() => setTab('attest')}
          >
            Attest <span className="tab-sub">create a sealed attestation</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'verify'}
            className={`tab ${tab === 'verify' ? 'is-active' : ''}`}
            onClick={() => setTab('verify')}
          >
            Verify <span className="tab-sub">read a verdict from chain</span>
          </button>
        </nav>

        {tab === 'attest' ? <AttestationCall wallet={wallet} /> : <VerifyAttestation />}
      </main>

      <footer className="site-footer">
        <p><strong>ProofAudit</strong> — Midnight Builder Challenge · Level 2</p>
        <p>Findings are proven with zero-knowledge proofs and never revealed on-chain.</p>
      </footer>
    </div>
  );
}
