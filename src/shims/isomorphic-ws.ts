// ═══════════════════════════════════════════════════════════════════════
// Browser shim for `isomorphic-ws`
//
// The Midnight indexer provider does `import * as ws from 'isomorphic-ws'`
// and then reads `ws.WebSocket`. The published browser build of isomorphic-ws
// only has a DEFAULT export (`export default WebSocket`), so `ws.WebSocket` is
// `undefined` once Rollup bundles for production — and the post-submit
// "wait for the transaction to confirm" subscription would call
// `new undefined(...)` and crash.
//
// In a browser, `isomorphic-ws` is always meant to be the global WebSocket, so
// we alias the package to this file (see vite.config.ts) and expose the global
// as BOTH a named and a default export. This removes the Rollup warning and
// makes `ws.WebSocket` resolve correctly.
// ═══════════════════════════════════════════════════════════════════════

const WS = globalThis.WebSocket;

export { WS as WebSocket };
export default WS;
