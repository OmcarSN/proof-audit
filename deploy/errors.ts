// ═══════════════════════════════════════════════════════════════════════
// Vault Circle — deep error serialization
//
// Midnight's wallet SDK throws Effect `Data.TaggedError` instances (e.g.
// `Wallet.Sync`). Those wrap the real failure in a `cause` field and often
// carry non-enumerable own-properties, so a plain `console.error(err)` or
// `JSON.stringify(err)` collapses to "[object Object]" with the actual detail
// lost. This walks the whole chain and surfaces everything.
// ═══════════════════════════════════════════════════════════════════════

/** Collect ALL own properties (including non-enumerable) into a plain object. */
function ownProps(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (key === 'stack') continue; // printed separately
    try {
      out[key] = (obj as Record<string, unknown>)[key];
    } catch {
      out[key] = '<unreadable>';
    }
  }
  return out;
}

/**
 * Produce a human-readable, multi-line description of any thrown value,
 * following `.cause` (and Effect's `.error` / `.failure`) as deep as it goes.
 */
export function describeError(err: unknown, depth = 0, seen = new Set<unknown>()): string {
  // removed hardcoded Wallet.Proving check

  const indent = '  '.repeat(depth + 1);

  if (err === null || err === undefined) return `${indent}${String(err)}`;
  if (typeof err !== 'object') return `${indent}${String(err)}`;
  if (seen.has(err)) return `${indent}<circular>`;
  seen.add(err);

  const lines: string[] = [];
  const tag = (err as { _tag?: string })._tag;
  const name = (err as { name?: string }).name ?? err.constructor?.name;
  const message = (err as { message?: unknown }).message;

  lines.push(`${indent}${tag ? `[${tag}] ` : ''}${name ?? 'Object'}${message ? `: ${String(message)}` : ''}`);

  // Dump own props that carry signal (skip the ones we recurse into or already printed).
  const props = ownProps(err);
  for (const [key, value] of Object.entries(props)) {
    if (['_tag', 'name', 'message', 'cause', 'error', 'failure'].includes(key)) continue;
    let rendered: string;
    try {
      rendered = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    } catch {
      rendered = '<unserializable>';
    }
    if (rendered && rendered !== '{}') lines.push(`${indent}  ${key}: ${rendered}`);
  }

  // Follow the nested-cause chain — this is where the real reason usually lives.
  for (const causeKey of ['cause', 'error', 'failure'] as const) {
    const nested = (err as Record<string, unknown>)[causeKey];
    if (nested && typeof nested === 'object' && nested !== err) {
      lines.push(`${indent}  ${causeKey} ↓`);
      lines.push(describeError(nested, depth + 1, seen));
    }
  }

  // Include the first stack frame set once, at the top level.
  if (depth === 0 && err instanceof Error && err.stack) {
    lines.push('', `${indent}stack:`, err.stack);
  }

  return lines.join('\n');
}
