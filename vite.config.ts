import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), wasm()],
  build: {
    target: 'es2022',
  },
  resolve: {
    // Force a SINGLE copy of the onchain runtime. Two versions are installed —
    // 3.1.0 hoisted at the top level (what compact-runtime + the managed
    // contract resolve to) and 3.0.0 nested under midnight-js-protocol — and
    // each ships its own `_StateValue` class. On a contract CALL, state parsed
    // by one copy is handed to the other, throwing "expected instance of
    // _StateValue". Pinning every import to the top-level 3.1.0 (satisfies
    // compact-runtime's ^3.0.0; the version the deployed circuit was built
    // with) collapses them to one class. dedupe is a backstop; the alias is
    // what actually reaches esbuild's dep pre-bundling.
    dedupe: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/compact-runtime',
      // compact-js + platform-js use module-local `Symbol()` tokens to stash a
      // contract's context on the compiled-contract object. If two copies load
      // (one optimized, one raw) their symbols differ, the context reads back
      // undefined, and findDeployedContract throws "Cannot read properties of
      // undefined (reading 'ctor')". Force a single instance of each.
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/platform-js',
    ],
    alias: [
      {
        find: '@midnight-ntwrk/compact-runtime',
        replacement: fileURLToPath(
          new URL('./node_modules/@midnight-ntwrk/compact-runtime', import.meta.url),
        ),
      },
      {
        find: /^@midnight-ntwrk\/onchain-runtime-v3$/,
        replacement: fileURLToPath(
          new URL('./node_modules/@midnight-ntwrk/onchain-runtime-v3', import.meta.url),
        ),
      },
      // The indexer provider reads `ws.WebSocket` from isomorphic-ws, whose
      // browser build only default-exports it — so the production bundle would
      // leave it undefined and the post-submit confirmation subscription would
      // crash. Point it at a shim that re-exports the browser's global.
      {
        find: 'isomorphic-ws',
        replacement: fileURLToPath(new URL('./src/shims/isomorphic-ws.ts', import.meta.url)),
      },
    ],
  },
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  optimizeDeps: {
    // compact-runtime carries the WASM engine (and is aliased above), so it must
    // stay un-prebundled — esbuild can't inline its WebAssembly. It's kept
    // external; packages that depend on it (e.g. compact-js) still pre-bundle
    // safely around it.
    exclude: [
      '@midnight-ntwrk/compact-runtime',
    ],
    // Everything reached via the dynamic import()s in src/midnight/contract.ts.
    // Vite's dep scanner can't see dynamic imports, so unless they're listed
    // here their CommonJS transitive deps get served raw and the browser throws
    // "exports is not defined" / "does not provide an export named 'default'"
    // in `npm run dev` (the production Rollup build is unaffected). Pre-bundling
    // converts the whole graph to ESM with proper interop.
    include: [
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
      '@midnight-ntwrk/midnight-js-http-client-proof-provider',
      // compact-js is dynamically imported in contract.ts. Because dynamic
      // imports are invisible to Vite's dep scanner, without this it can be
      // served RAW as a second module instance — and its module-local Symbol()
      // context token then mismatches the optimized copy that
      // midnight-js-contracts uses, throwing "reading 'ctor'" on submit. Listing
      // it here (with platform-js, its peer) guarantees ONE pre-bundled copy.
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/platform-js',
      // midnight-js-contracts was previously *excluded*, which left its own
      // CommonJS deps (midnight-js-protocol, midnight-js-utils) to be served raw
      // — the actual source of "exports is not defined" on submit. Pre-bundling
      // it pulls those deps into the ESM-converted graph. It does NOT depend on
      // compact-runtime, so no WASM is dragged in (compact-js proves the pattern
      // works: it depends on compact-runtime yet pre-bundles fine).
      '@midnight-ntwrk/midnight-js-contracts',
      '@midnight-ntwrk/midnight-js-protocol',
      '@midnight-ntwrk/midnight-js-utils',
      // Decodes a shielded address → coin/encryption public keys for the newer
      // DUST-model Lace (see deriveShieldedKeys in src/midnight/contract.ts).
      // Dynamically imported, so Vite's scanner won't pre-bundle it unless it's
      // listed here — otherwise its CommonJS deps get served raw in dev.
      '@midnight-ntwrk/wallet-sdk-address-format',
      'object-inspect',
    ],
  },
});

