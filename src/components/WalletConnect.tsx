import type { UseMidnight } from '../hooks/useMidnight';

interface Props {
  wallet: UseMidnight;
}

export function WalletConnect({ wallet }: Props) {
  const { status, connection, error, hint, connect, disconnect, redetect } = wallet;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="ico" aria-hidden="true">🔐</span>
        <h2>Wallet</h2>
      </div>

      {status === 'detecting' && (
        <div className="wallet-row"><span className="spinner" /> Looking for the Lace wallet…</div>
      )}

      {status === 'unavailable' && (
        <div className="banner banner-warn">
          <div className="banner-title">Lace wallet not detected</div>
          <p>
            Install the <a className="link" href="https://lace.io" target="_blank" rel="noopener">Midnight Lace</a> browser
            extension and make sure it's enabled, then re-scan.
          </p>
          <div className="banner-actions">
            <button className="btn-icon" onClick={() => void redetect()}>Re-scan</button>
          </div>
        </div>
      )}

      {status === 'idle' && (
        <div className="wallet-status">
          <p className="muted" style={{ marginBottom: '0.9rem' }}>Lace detected. Connect to continue.</p>
          <button className="btn btn-primary" onClick={connect}>Connect Lace wallet</button>
        </div>
      )}

      {status === 'connecting' && (
        <div className="wallet-row"><span className="spinner" /> Connecting to Lace — this can take a moment while your wallet syncs…</div>
      )}

      {status === 'connected' && connection && (
        <div className="wallet-status">
          <div className="wallet-connected-head">
            <span className="dot" /> <strong>Connected</strong>
            <span className="muted">· {connection.walletName}</span>
          </div>
          <div className="wallet-addr-block">
            <span className="addr-label">Address</span>
            <code>{connection.state.address || 'Shielded (address hidden)'}</code>
          </div>
          <button className="btn btn-danger" onClick={disconnect}>Disconnect</button>
        </div>
      )}

      {status === 'error' && (
        <div className="banner banner-err">
          <div className="banner-title">Connection problem</div>
          <p>{error}</p>
          <div className="banner-actions">
            <button className="btn-icon" onClick={connect}>Try again</button>
            <button className="btn-icon" onClick={() => void redetect()}>Re-scan</button>
          </div>
        </div>
      )}

      {hint && <p className="wallet-hint">{hint}</p>}
    </section>
  );
}
