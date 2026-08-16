// ═══════════════════════════════════════════════════════════════════════
// Hashing helpers
//
// The contract's `contractHash` is a Bytes<32>. Instead of making people
// hand-type 64 hex characters, we let them describe what they audited (a
// name, an address, or the pasted source) and derive the 32 bytes with
// SHA-256. An advanced path still accepts a raw hex hash.
// ═══════════════════════════════════════════════════════════════════════

/** SHA-256 of a UTF-8 string → 32 bytes. */
export async function sha256Text(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

/** SHA-256 of a file's bytes → 32 bytes. */
export async function sha256File(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

/** 32 bytes → lowercase hex string (no 0x prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse a raw hex string (advanced mode) into exactly 32 bytes.
 * Throws with a plain-language message the UI can show directly.
 */
export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('The hash can only contain hex characters (0–9, a–f).');
  }
  if (clean.length !== 64) {
    throw new Error(`A raw hash must be exactly 64 hex characters — you entered ${clean.length}.`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
