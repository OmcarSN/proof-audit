// Buffer polyfill — Midnight SDK expects Node's Buffer in the browser
import { Buffer } from 'buffer';
const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}

import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// NOTE: intentionally NOT wrapped in <StrictMode>. The Midnight dApp connector
// exposes a single live wallet API channel; StrictMode's dev-only double
// invocation of effects opens a second connection that shuts the first one
// down, surfacing as "channel 'midnight-wallet' was shutdown: object can no
// longer be used." Production never double-invokes, so dropping StrictMode
// makes dev behave like production. connectLace() also dedupes concurrent
// calls as a second line of defence.
createRoot(rootEl).render(<App />);
