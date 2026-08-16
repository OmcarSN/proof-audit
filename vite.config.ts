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
    alias: {
      '@midnight-ntwrk/compact-runtime': fileURLToPath(
        new URL('./node_modules/@midnight-ntwrk/compact-runtime', import.meta.url),
      ),
      // The indexer provider reads `ws.WebSocket` from isomorphic-ws, whose
      // browser build only default-exports it — so the production bundle would
      // leave it undefined and the post-submit confirmation subscription would
      // crash. Point it at a shim that re-exports the browser's global.
      'isomorphic-ws': fileURLToPath(
        new URL('./src/shims/isomorphic-ws.ts', import.meta.url),
      ),
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  optimizeDeps: {
    // These carry WASM / top-level-await and must not be pre-bundled by esbuild.
    exclude: [
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-contracts',
    ],
    // These are loaded via dynamic import() in src/midnight/contract.ts, so
    // Vite's dep scanner misses them in dev. Force pre-bundling so their CJS
    // transitive deps (e.g. object-inspect) get proper ESM interop — otherwise
    // the Verify read path throws "does not provide an export named 'default'"
    // in `npm run dev` (the production build is unaffected). object-inspect is
    // listed explicitly because its importer (compact-runtime) is excluded
    // above, so only a direct include gives it an interop default export.
    include: [
      '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
      '@midnight-ntwrk/midnight-js-http-client-proof-provider',
      'object-inspect',
    ],
  },
});

