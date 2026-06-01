/**
 * sources.ts — read the available sources from the cloned 5etools data so the
 * Configure tab can offer a pick-list (friendly names) instead of making users
 * type source codes. `data/books.json` and `data/adventures.json` each hold an
 * array under a top-level key ("book" / "adventure") of entries with an `id`
 * (the source code, e.g. "PHB") and a `name`.
 */
import { toList } from "./config";

export interface SourceEntry {
  id: string;
  name: string;
  group?: string;
}

/** Parse books.json / adventures.json text into {id, name} entries. */
export function parseSourceList(text: string, key: "book" | "adventure"): SourceEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = (data as Record<string, unknown>)?.[key];
  if (!Array.isArray(arr)) return [];
  const out: SourceEntry[] = [];
  for (const e of arr) {
    if (e && typeof e === "object") {
      const id = (e as Record<string, unknown>).id;
      const name = (e as Record<string, unknown>).name;
      if (typeof id === "string") {
        out.push({
          id,
          name: typeof name === "string" ? name : id,
          group: typeof (e as Record<string, unknown>).group === "string"
            ? ((e as Record<string, unknown>).group as string)
            : undefined,
        });
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Merge `add` codes into a comma-separated `existing` string, de-duplicating. */
export function mergeCodes(existing: string, add: string[]): string {
  const have = toList(existing);
  const set = new Set(have);
  for (const code of add) if (!set.has(code)) { have.push(code); set.add(code); }
  return have.join(", ");
}
