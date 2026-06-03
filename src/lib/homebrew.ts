/**
 * homebrew.ts — pure logic for the homebrew source browser.
 *
 * Takes the list of `.json` paths found under the home `homebrew/` folder
 * (relative to that folder, forward-slashed, e.g. "book/Author; Title.json")
 * and turns them into categorised, labelled entries. No file contents are read:
 * the category comes from the top-level subfolder and the label from the
 * filename, which follows the community "Author; Title.json" convention.
 */

export interface HomebrewEntry {
  /** Path written into the config, e.g. "homebrew/book/Author; Title.json". */
  path: string;
  /** Path relative to the homebrew folder, e.g. "book/Author; Title.json". */
  rel: string;
  /** Display category, e.g. "Book". */
  category: string;
  /** Raw subfolder, e.g. "book" (""/"Other" when at the homebrew root). */
  categoryKey: string;
  /** Title portion of the filename. */
  title: string;
  /** Author portion (text before the first "; "); "" when absent. */
  author: string;
  /** Filename without extension — used for search and as a fallback label. */
  name: string;
}

export interface HomebrewGroup {
  category: string;
  entries: HomebrewEntry[];
}

const CATEGORY_LABELS: Record<string, string> = {
  adventure: "Adventure",
  book: "Book",
  collection: "Collection",
  creature: "Creature",
  spell: "Spell",
  item: "Item",
  race: "Race",
  class: "Class",
  subclass: "Subclass",
  background: "Background",
  feat: "Feat",
  optionalfeature: "Optional Feature",
  deity: "Deity",
  object: "Object",
  vehicle: "Vehicle",
  psionic: "Psionic",
  reward: "Reward",
  variantrule: "Variant Rule",
  table: "Table",
};

/** "book" -> "Book", "variantrule" -> "Variant Rule", "" -> "Other". */
export function prettyCategory(key: string): string {
  if (!key) return "Other";
  return CATEGORY_LABELS[key.toLowerCase()] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

// Big "source" categories first, then the rest alphabetically.
const CATEGORY_ORDER = ["Collection", "Book", "Adventure", "Creature", "Spell", "Item"];

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/** Parse one relative path into an entry. */
function parseOne(rel: string): HomebrewEntry {
  const clean = rel.replace(/^\.?\//, "").replace(/\\/g, "/");
  const segments = clean.split("/").filter(Boolean);
  const file = segments[segments.length - 1] ?? clean;
  const categoryKey = segments.length > 1 ? segments[0] : "";
  const name = file.replace(/\.json$/i, "");
  const sep = name.indexOf("; ");
  const author = sep >= 0 ? name.slice(0, sep).trim() : "";
  const title = sep >= 0 ? name.slice(sep + 2).trim() : name;
  return {
    path: `homebrew/${clean}`,
    rel: clean,
    category: prettyCategory(categoryKey),
    categoryKey,
    title,
    author,
    name,
  };
}

/** Parse + de-duplicate a list of relative homebrew paths. */
export function parseHomebrew(relPaths: string[]): HomebrewEntry[] {
  const seen = new Set<string>();
  const out: HomebrewEntry[] = [];
  for (const raw of relPaths) {
    if (!raw || !/\.json$/i.test(raw)) continue;
    const entry = parseOne(raw);
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push(entry);
  }
  return out;
}

/** Group entries by category, ordered for display, titles sorted within. */
export function groupHomebrew(entries: HomebrewEntry[]): HomebrewGroup[] {
  const byCat = new Map<string, HomebrewEntry[]>();
  for (const e of entries) {
    const arr = byCat.get(e.category) ?? [];
    arr.push(e);
    byCat.set(e.category, arr);
  }
  const groups: HomebrewGroup[] = [];
  for (const [category, list] of byCat) {
    list.sort((a, b) => a.title.localeCompare(b.title));
    groups.push({ category, entries: list });
  }
  groups.sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category),
  );
  return groups;
}

/** Case-insensitive match across title, author, and category. */
export function matchesQuery(e: HomebrewEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    e.title.toLowerCase().includes(q) ||
    e.author.toLowerCase().includes(q) ||
    e.category.toLowerCase().includes(q)
  );
}
