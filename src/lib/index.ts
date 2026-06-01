/**
 * index.ts — parse and filter the converter's `all-index.json`.
 *
 * The CLI writes all-index.json (every discovered data key) into the output
 * folder when run with --index. We read it so users can pick keys for the
 * include/exclude filters instead of hand-typing `monster|expert|dc`.
 *
 * The exact shape has varied (a JSON array of key strings, or an object keyed
 * by data key), so the parser is deliberately tolerant.
 */

export function parseIndexKeys(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      if (v.includes("|")) out.add(v); // data keys look like "type|name|src"
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    }
  };
  if (Array.isArray(data)) {
    data.forEach(visit);
  } else if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (k.includes("|")) out.add(k); // keys are the data keys
      visit(v); // values may also hold key strings/arrays
    }
  }
  return Array.from(out).sort();
}

/** Case-insensitive substring filter, capped for rendering performance. */
export function filterKeys(keys: string[], query: string, limit = 200): string[] {
  const q = query.trim().toLowerCase();
  const matches = q ? keys.filter((k) => k.toLowerCase().includes(q)) : keys;
  return matches.slice(0, limit);
}
