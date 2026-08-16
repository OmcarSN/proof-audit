// ═══════════════════════════════════════════════════════════════════════
// Proof-server preflight
//
// ZK proofs are generated locally by the Midnight proof server (Docker, port
// 6300). If it isn't running, submitting fails with a cryptic error — so we
// check first and, if it's unreachable, show the exact command to start it.
// ═══════════════════════════════════════════════════════════════════════

import { ENDPOINTS } from '../config/network';

/** The one command that starts the local proof server. */
export const PROOF_SERVER_DOCKER_CMD =
  'docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0';

/**
 * Best-effort "is something listening on the proof-server port" check.
 *
 * The proof server doesn't send permissive CORS headers, so we can't read a
 * JSON health body from the browser. A `no-cors` fetch is enough: if it
 * resolves, a server accepted the connection; if the port is closed the fetch
 * rejects. (On an https deployment, a request to an http localhost server is
 * blocked as mixed content and will read as "down" — run the app locally via
 * `npm run dev` for the full flow.)
 */
export async function isProofServerUp(timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(ENDPOINTS.proofServer, { mode: 'no-cors', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
