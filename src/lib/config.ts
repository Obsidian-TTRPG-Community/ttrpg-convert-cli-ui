/**
 * config.ts — builds the ttrpg-convert-cli `config.json`.
 *
 * Port of the original VB `BuildConfigFile`, extended to cover the full set of
 * documented config keys: sources (+ defaultSource), paths, images, the content
 * filters (include / exclude / excludePattern), racesAsSpecies,
 * onlyReferencedTables, yamlStatblocks, reprintBehavior, useDiceRoller,
 * tagPrefix, and the complete template-key set.
 *
 * The builder takes already-structured input (arrays/maps); string parsing from
 * the UI (splitting lines, parsing "k=v" pairs) lives in main.ts so this module
 * stays pure and easy to test. Keys are only emitted when they carry a value,
 * matching the docs' guidance ("delete the attribute if unused").
 */

/** All valid 5etools template keys (per the converter's convertData.json). */
export const TEMPLATE_KEYS_5E = [
  "background", "class", "deck", "deity", "feat", "hazard", "item", "monster",
  "note", "object", "psionic", "race", "reward", "spell", "subclass", "vehicle",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS_5E)[number];

export interface ConfigInput {
  sources: {
    adventure: string; // comma-separated source codes
    book: string;
    reference: string;
    homebrew: string;
    /** type -> source override, e.g. { monster: "XMM" }. */
    defaultSource?: Record<string, string>;
  };
  paths: { rules: string; compendium: string };
  images: {
    copyInternal: boolean;
    copyExternal: boolean;
    internalRoot: string;
    /** original path -> replacement path. */
    fallbackPaths?: Record<string, string>;
  };
  include?: string[];
  exclude?: string[];
  excludePattern?: string[];
  racesAsSpecies?: boolean;
  onlyReferencedTables?: boolean;
  useFantasyStatblocks: boolean;
  reprintBehavior: string;
  useDiceRoller: boolean;
  tagPrefix: string;
  /** Folder (relative to CLI home) holding the template .txt files. */
  templateRelativePath: string;
  /** template key -> chosen file name (empty entries are skipped). */
  templates: Partial<Record<TemplateKey, string>>;
}

/** Split "a, b ,c" -> ["a","b","c"]; "" -> []. */
export function toList(csv: string): string[] {
  if (!csv || csv.trim() === "") return [];
  return csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Split on newlines: "a\nb" -> ["a","b"]; "" -> []. Used for values that may
 *  themselves contain commas (e.g. homebrew file paths). */
export function toLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Reconstruct homebrew paths that an older build shattered on commas. Earlier
 * versions stored the homebrew list comma-joined, so any filename containing a
 * comma (e.g. "Flee, Mortals!.json") was split into a dead, extension-less path
 * plus an orphan fragment — which made the converter throw a NullPointerException
 * trying to read a file that didn't exist. We stitch any entry that doesn't end
 * in ".json" back together with the entries that follow it (re-inserting ", ")
 * until it does. A correctly-stored list passes through untouched.
 */
export function repairHomebrew(entries: string[]): string[] {
  const out: string[] = [];
  let buf = "";
  for (const raw of entries) {
    const part = (raw ?? "").trim();
    if (!part) continue;
    buf = buf ? `${buf}, ${part}` : part;
    if (/\.json$/i.test(buf)) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf); // trailing fragment with no .json — keep verbatim
  return out;
}

/** Build the ordered, serialisable config object. */
export function buildConfig(input: ConfigInput): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};

  const sources: Record<string, unknown> = {
    adventure: toList(input.sources.adventure),
    book: toList(input.sources.book),
    reference: toList(input.sources.reference),
    homebrew: toLines(input.sources.homebrew),
  };
  if (input.sources.defaultSource && Object.keys(input.sources.defaultSource).length > 0) {
    sources.defaultSource = input.sources.defaultSource;
  }
  cfg.sources = sources;

  cfg.paths = { rules: input.paths.rules, compendium: input.paths.compendium };

  const images: Record<string, unknown> = {
    copyInternal: input.images.copyInternal,
    copyExternal: input.images.copyExternal,
    internalRoot: input.images.internalRoot,
  };
  if (input.images.fallbackPaths && Object.keys(input.images.fallbackPaths).length > 0) {
    images.fallbackPaths = input.images.fallbackPaths;
  }
  cfg.images = images;

  // Content filters — only present when non-empty.
  if (input.excludePattern && input.excludePattern.length > 0) cfg.excludePattern = input.excludePattern;
  if (input.exclude && input.exclude.length > 0) cfg.exclude = input.exclude;
  if (input.include && input.include.length > 0) cfg.include = input.include;

  if (input.racesAsSpecies) cfg.racesAsSpecies = true;
  if (input.onlyReferencedTables) cfg.onlyReferencedTables = true;
  if (input.useFantasyStatblocks) cfg.yamlStatblocks = true;

  cfg.reprintBehavior = input.reprintBehavior;
  cfg.useDiceRoller = input.useDiceRoller;
  cfg.tagPrefix = input.tagPrefix;

  const template: Record<string, string> = {};
  for (const key of TEMPLATE_KEYS_5E) {
    const file = input.templates[key];
    if (file && file.trim() !== "") {
      template[key] = `${input.templateRelativePath}/${file}`;
    }
  }
  if (Object.keys(template).length > 0) cfg.template = template;

  return cfg;
}

/** Serialise to the JSON text written to disk (2-space indent). */
export function buildConfigJson(input: ConfigInput): string {
  return JSON.stringify(buildConfig(input), null, 2);
}

/** Basename of a template path ("a/b/monster2md.txt" -> "monster2md.txt"). */
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Reverse of buildConfig: parse a saved config.json into the flat field map the
 * Configure form uses (keys match the form's data-cfg names). Lets the UI load
 * an existing config back for editing/reuse. Throws on invalid JSON.
 */
export function configToFields(text: string): Record<string, string | boolean> {
  const cfg = JSON.parse(text) as Record<string, any>;
  const f: Record<string, string | boolean> = {};
  const sources = cfg.sources ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
  f.adventure = list(sources.adventure);
  f.book = list(sources.book);
  f.reference = list(sources.reference);
  f.homebrew = repairHomebrew(Array.isArray(sources.homebrew) ? (sources.homebrew as string[]) : []).join("\n");
  f.defaultSource = sources.defaultSource && typeof sources.defaultSource === "object"
    ? Object.entries(sources.defaultSource).map(([k, v]) => `${k}=${v}`).join(", ")
    : "";

  const paths = cfg.paths ?? {};
  f.rules = typeof paths.rules === "string" ? paths.rules : "rules";
  f.compendium = typeof paths.compendium === "string" ? paths.compendium : "compendium";

  const images = cfg.images ?? {};
  f.copyInternal = !!images.copyInternal;
  f.copyExternal = !!images.copyExternal;
  f.internalRoot = typeof images.internalRoot === "string" ? images.internalRoot : "";

  const lines = (v: unknown) => (Array.isArray(v) ? v.join("\n") : "");
  f.include = lines(cfg.include);
  f.exclude = lines(cfg.exclude);
  f.excludePattern = lines(cfg.excludePattern);

  f.racesAsSpecies = !!cfg.racesAsSpecies;
  f.onlyReferencedTables = !!cfg.onlyReferencedTables;
  f.useFantasyStatblocks = !!cfg.yamlStatblocks;
  f.reprintBehavior = typeof cfg.reprintBehavior === "string" ? cfg.reprintBehavior : "newest";
  f.useDiceRoller = !!cfg.useDiceRoller;
  f.tagPrefix = typeof cfg.tagPrefix === "string" ? cfg.tagPrefix : "ttrpg";

  const tpl = cfg.template ?? {};
  for (const key of TEMPLATE_KEYS_5E) {
    f[`tpl_${key}`] = typeof tpl[key] === "string" ? basename(tpl[key]) : "";
  }
  return f;
}
