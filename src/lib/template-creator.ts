/**
 * template-creator.ts — pure helpers for the in-app Template Creator.
 *
 * Variables offered to the user are EXTRACTED FROM THEIR INSTALLED TEMPLATES
 * (real, working `resource.*` references) rather than a hardcoded field list,
 * so they're always valid for the converter version in use.
 *
 * The preview is an APPROXIMATION — a tiny Qute-like renderer for `{var}`,
 * `{#if}`, `{#for}`, `{#each}`. It is NOT the converter's exact output (it can't
 * be without running the converter): conditionals are shown as if true, and
 * helper/extension methods aren't evaluated.
 */

/**
 * Suggest a file name for a newly-created template so the config dropdowns pick
 * it up automatically. The Configure-tab dropdowns filter templates purely by
 * FILE NAME (each key's `<select>` shows a file only if its name contains that
 * key as a substring — with `statblock` also required for the Fantasy-Statblocks
 * monster variant, and `subclass` distinguishing class vs. subclass). So the
 * chosen name MUST embed the type keyword or the template will never appear in
 * the list. This returns a safe default that satisfies those rules.
 *
 * The `my-` prefix keeps it distinct from the installed stock templates
 * (e.g. `background2md.txt`) so saving doesn't silently overwrite them.
 */
export function suggestTemplateFilename(type: string, fant: boolean): string {
  const t = type.toLowerCase().trim();
  if (t === "monster") return fant ? "my-monster2md-statblock.txt" : "my-monster2md.txt";
  return `my-${t}2md.txt`;
}

/** Pull unique `resource.*` references out of a template's text, sorted. */
export function extractVariables(text: string): string[] {
  const set = new Set<string>();
  const re = /resource\.[A-Za-z0-9_.]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    set.add(m[0].replace(/\.+$/, "")); // drop any trailing dot
  }
  return Array.from(set).sort();
}

/* ---- structured variable tree (objects, arrays, array item-fields) ---- */
export type VarKind = "scalar" | "object" | "list";
export interface VarNode {
  label: string;
  kind: VarKind;
  insert?: string; // text inserted at the cursor when clicked
  hint?: string;
  children?: VarNode[];
}
interface ListInfo { itemVar: string; fields: Set<string>; scalarItem: boolean; }

/** Bare `resource.x.y` scalar paths in a text, trimming trailing `.method(` calls. */
function scalarPaths(text: string): string[] {
  const out: string[] = [];
  const re = /resource\.([A-Za-z0-9_.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let path = m[1].replace(/\.+$/, "");
    if (text[m.index + m[0].length] === "(") path = path.replace(/\.[A-Za-z0-9_]+$/, "");
    if (path) out.push(path);
  }
  return out;
}
function collectItemFields(body: string, itemVar: string, info: ListInfo) {
  const re = new RegExp("\\{" + itemVar + "(?:\\.([A-Za-z0-9_.]+))?\\}", "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1]) info.fields.add(m[1]); else info.scalarItem = true;
  }
}

/**
 * Build a navigable variable tree from the user's installed template texts.
 * Objects (e.g. `scores`) become expandable branches; arrays (e.g. `action`)
 * become list nodes whose children are the item fields the loops actually use
 * (e.g. `{action.name}`, `{action.desc}`). Accurate by construction — only
 * what real templates reference.
 */
export function buildVariableTree(texts: string[]): VarNode[] {
  const scalars = new Set<string>();
  const lists = new Map<string, ListInfo>();
  const forRe = /\{#for\s+(\w+)\s+in\s+resource\.([\w.]+)(\([^)]*\))?\s*\}([\s\S]*?)\{\/for\}/g;
  const eachRe = /\{#each\s+resource\.([\w.]+)\s*\}([\s\S]*?)\{\/each\}/g;

  for (const text of texts) {
    let m: RegExpExecArray | null;
    forRe.lastIndex = 0;
    while ((m = forRe.exec(text))) {
      const [, itemVar, base, call, body] = m;
      if (call) { scalars.add(base); continue; } // method-derived iteration; base stays scalar
      const info = lists.get(base) ?? { itemVar, fields: new Set<string>(), scalarItem: false };
      info.itemVar = itemVar;
      collectItemFields(body, itemVar, info);
      lists.set(base, info);
    }
    eachRe.lastIndex = 0;
    while ((m = eachRe.exec(text))) {
      const [, base, body] = m;
      const info = lists.get(base) ?? { itemVar: "it", fields: new Set<string>(), scalarItem: false };
      info.itemVar = "it";
      collectItemFields(body, "it", info);
      lists.set(base, info);
    }
    for (const p of scalarPaths(text)) scalars.add(p);
  }
  for (const base of lists.keys()) scalars.delete(base); // arrays aren't scalar leaves

  return assembleTree(scalars, lists);
}

function assembleTree(scalars: Set<string>, lists: Map<string, ListInfo>): VarNode[] {
  const root: VarNode = { label: "resource", kind: "object", children: [] };
  const ensureObj = (parent: VarNode, label: string): VarNode => {
    let n = parent.children!.find((c) => c.label === label && c.kind !== "scalar");
    if (!n) { n = { label, kind: "object", children: [] }; parent.children!.push(n); }
    return n;
  };
  // A path that is a strict prefix of another is an object (expandable), not a leaf.
  const objectPaths = new Set<string>();
  for (const p of scalars) {
    const segs = p.split(".");
    for (let i = 1; i < segs.length; i++) objectPaths.add(segs.slice(0, i).join("."));
  }
  for (const path of scalars) {
    const segs = path.split(".");
    let parent = root, acc = "resource";
    segs.forEach((seg, i) => {
      acc += "." + seg;
      const partial = segs.slice(0, i + 1).join(".");
      const isLast = i === segs.length - 1;
      if (objectPaths.has(partial)) {
        parent = ensureObj(parent, seg);
        // used bare as well as with sub-fields → also insertable as the whole block
        if (isLast) { parent.insert = `{${acc}}`; parent.hint = "insert the whole block"; }
      } else if (isLast) {
        if (!parent.children!.some((c) => c.label === seg && c.kind === "scalar"))
          parent.children!.push({ label: seg, kind: "scalar", insert: `{${acc}}` });
      } else parent = ensureObj(parent, seg);
    });
  }
  for (const [base, info] of lists) {
    const segs = base.split(".");
    let parent = root;
    for (let i = 0; i < segs.length - 1; i++) parent = ensureObj(parent, segs[i]);
    const leaf = segs[segs.length - 1];
    const fields = Array.from(info.fields).sort();
    const body = fields.length ? fields.map((f) => `{${info.itemVar}.${f}}`).join(" ") : `- {${info.itemVar}}`;
    const node: VarNode = {
      label: leaf, kind: "list",
      insert: `{#for ${info.itemVar} in resource.${base}}\n${body}\n{/for}\n`,
      hint: `list — loops as “${info.itemVar}”`,
      children: fields.map((f) => ({
        label: f, kind: "scalar" as const,
        insert: `{${info.itemVar}.${f}}`, hint: `use inside the ${info.itemVar} loop`,
      })),
    };
    if (!fields.length && info.scalarItem)
      node.children!.push({ label: "(value)", kind: "scalar", insert: `{${info.itemVar}}`, hint: `use inside the ${info.itemVar} loop` });
    parent.children!.push(node);
  }
  sortNodes(root.children!);
  return root.children!;
}
function sortNodes(nodes: VarNode[]) {
  const order: Record<VarKind, number> = { scalar: 0, object: 1, list: 2 };
  nodes.sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label));
  for (const n of nodes) if (n.children) sortNodes(n.children);
}

export interface SampleItem {
  label: string;
  scalar(sub: string): string;
}
export interface Sample {
  scalar(path: string): string;
  list(path: string): SampleItem[];
}

function scope(body: string, name: string, item: SampleItem): string {
  return body.replace(
    new RegExp("\\{" + name + "(\\.[\\w.]+)?\\}", "g"),
    (_f, sub) => (sub ? item.scalar((sub as string).slice(1)) : item.label),
  );
}

/**
 * Approximate render of a template against sample data. Resolves innermost
 * control blocks first; `{#if}` always takes the true branch (so the preview
 * shows the fullest version of the note).
 */
export function renderTemplatePreview(text: string, sample: Sample): string {
  let out = text;
  let guard = 0;
  // Matches an innermost {#if|for|each ...} ... {/...} (body has no nested opener).
  const re = /\{#(if|for|each)\b([^}]*)\}((?:(?!\{#(?:if|for|each)\b)[\s\S])*?)\{\/\1\}/;
  while (guard++ < 5000 && re.test(out)) {
    out = out.replace(re, (_m, kind: string, expr: string, body: string) => {
      if (kind === "if") {
        const ei = body.indexOf("{#else}");
        return ei >= 0 ? body.slice(0, ei) : body;
      }
      if (kind === "for") {
        const mm = expr.match(/(\w+)\s+in\s+([\w.]+)/);
        if (!mm) return "";
        return sample.list(mm[2]).map((it) => scope(body, mm[1], it)).join("");
      }
      const mm = expr.match(/([\w.]+)/); // each: {#each resource.list}
      if (!mm) return "";
      return sample.list(mm[1]).map((it) => scope(body, "it", it)).join("");
    });
  }
  return out.replace(/\{([\w.]+)\}/g, (_m, path: string) => sample.scalar(path));
}

/** Build readable sample data for a preview from the template's own references. */
export function buildSample(): Sample {
  const KNOWN: Record<string, string> = {
    "resource.name": "Example Entry",
    "resource.source": "PHB",
    "resource.text": "Sample body text describing the entry.\n\nA second paragraph with **bold** text.",
    "resource.prerequisite": "Sample prerequisite",
    "resource.showPortraitImage": "![[portrait.png]]",
    "resource.showMoreImages": "![[gallery-1.png]]",
  };
  const titlecase = (path: string) => {
    const seg = path.split(".").pop() || path;
    return seg.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
  };
  return {
    scalar: (path) => (path in KNOWN ? KNOWN[path] : titlecase(path)),
    list: () => [
      { label: "sample-one", scalar: (s) => "Sample " + (s.split(".").pop() || s) },
      { label: "sample-two", scalar: (s) => "Sample " + (s.split(".").pop() || s) },
    ],
  };
}
