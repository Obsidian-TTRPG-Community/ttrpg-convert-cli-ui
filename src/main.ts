/**
 * main.ts — controller for the download-once / run-many workflow, extended with
 * the full config-key set: content filters (include/exclude/excludePattern),
 * defaultSource overrides, racesAsSpecies / onlyReferencedTables, every 5e
 * template key, an index-driven key picker, and run-time log/debug/verbose flags.
 */
import { buildConfigJson, configToFields, toList, TEMPLATE_KEYS_5E, type ConfigInput, type TemplateKey } from "./lib/config";
import {
  detectHost, pathExists, findConverter, installCli, installTemplates, runConverter, gitClone, gitPull,
  writeConfigFile, readTextFile, listTemplates, listConfigs, loadIndexKeys, loadSources,
  installBundledAssets, pickFolder, joinHome, TEMPLATES_REL, saveTemplate, readTemplate, openPath,
  checkAppUpdate, listHomebrew, type Progress,
} from "./lib/cli";
import { APP_RELEASES_PAGE, type AppUpdate } from "./lib/update-check";
import { parseHomebrew, groupHomebrew, matchesQuery, type HomebrewEntry } from "./lib/homebrew";
import { filterKeys } from "./lib/index";
import { type SourceEntry } from "./lib/sources";
import { renderTemplatePreview, buildSample, buildVariableTree, suggestTemplateFilename, type VarNode } from "./lib/template-creator";
import { conversionGuidance, pluginUrl } from "./lib/guidance";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { getVersion } from "@tauri-apps/api/app";
import { loadState, saveState, DEFAULT_STATE, type PersistedState, type Theme } from "./lib/settings";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
let state: PersistedState = { ...DEFAULT_STATE };
let appVersion = ""; // filled from Tauri's getVersion() at startup
const persist = () => void saveState(state);
let indexKeys: string[] = []; // transient, from all-index.json
let creatorTree: VarNode[] = [];
let creatorTreeEmpty = true;
let creatorFilenameAuto = ""; // last auto-suggested filename; lets us prefill without clobbering user edits
const INDEX_OUT = "_index"; // throwaway output folder used to generate the index
const sourceCache: Partial<Record<"book" | "adventure", SourceEntry[]>> = {};

function log(line: string) {
  const el = $("#log");
  el.textContent += (el.textContent ? "\n" : "") + line;
  el.scrollTop = el.scrollHeight;
}

/* ---- theme ---- */
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
const resolveTheme = (t: Theme) => (t === "system" ? (prefersDark.matches ? "dark" : "light") : t);
function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", resolveTheme(t));
  try { localStorage.setItem("theme", t); } catch { /* storage unavailable */ }
}
// First paint is handled by the inline script in index.html (reads localStorage);
// init() applies the authoritative saved theme once settings load.
prefersDark.addEventListener("change", () => {
  if (state.theme === "system") applyTheme("system");
});
$("#theme-select").addEventListener("change", (e) => {
  state.theme = (e.target as HTMLSelectElement).value as Theme;
  applyTheme(state.theme);
  persist();
});

/* ---- generate the template-key selects up front (before listeners) ---- */
function buildTemplateGrid() {
  const grid = $("#template-grid");
  for (const key of TEMPLATE_KEYS_5E) {
    const cell = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = key;
    const sel = document.createElement("select");
    sel.setAttribute("data-cfg", `tpl_${key}`);
    cell.append(label, sel);
    grid.appendChild(cell);
  }
}
buildTemplateGrid();

/* ---- tabs ---- */
let runReady = false;
function setRunReady(ready: boolean) {
  runReady = ready;
  const tab = document.querySelector('.tab[data-tab="run"]') as HTMLButtonElement;
  tab.classList.toggle("locked", !ready);
  tab.title = ready ? "" : "Save a config file first (Configure tab)";
}
document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    if (tab.dataset.tab === "run" && !runReady) {
      log("Save a config first — the Run tab needs a config file in your CLI home folder.");
      return;
    }
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "config") void refreshTemplates();
    if (tab.dataset.tab === "run") { void refreshConfigList(); void renderRunGuidance(); }
  }),
);
setRunReady(false); // locked until refreshConfigList finds a saved config

/* ---- config form <-> state ---- */
const STATIC_CFG = [
  "adventure", "book", "reference", "homebrew", "rules", "compendium",
  "internalRoot", "reprintBehavior", "tagPrefix", "defaultSource",
  "include", "exclude", "excludePattern",
  "copyInternal", "copyExternal", "useDiceRoller", "useFantasyStatblocks",
  "racesAsSpecies", "onlyReferencedTables",
];
const CFG_KEYS = [...STATIC_CFG, ...TEMPLATE_KEYS_5E.map((k) => `tpl_${k}`)];
const cfgEl = (k: string) => $(`[data-cfg="${k}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const splitLines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
function parseKeyVals(s: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const part of s.split(",")) {
    const i = part.indexOf("=");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k && v) m[k] = v;
    }
  }
  return m;
}

function readConfigInput(): ConfigInput {
  const v = (k: string) => (cfgEl(k) as HTMLInputElement)?.value ?? "";
  const c = (k: string) => (cfgEl(k) as HTMLInputElement)?.checked ?? false;
  const templates: Partial<Record<TemplateKey, string>> = {};
  for (const key of TEMPLATE_KEYS_5E) templates[key] = v(`tpl_${key}`);
  return {
    sources: {
      adventure: v("adventure"), book: v("book"), reference: v("reference"), homebrew: v("homebrew"),
      defaultSource: parseKeyVals(v("defaultSource")),
    },
    paths: { rules: v("rules") || "rules", compendium: v("compendium") || "compendium" },
    images: { copyInternal: c("copyInternal"), copyExternal: c("copyExternal"), internalRoot: v("internalRoot") },
    include: splitLines(v("include")),
    exclude: splitLines(v("exclude")),
    excludePattern: splitLines(v("excludePattern")),
    racesAsSpecies: c("racesAsSpecies"),
    onlyReferencedTables: c("onlyReferencedTables"),
    useFantasyStatblocks: c("useFantasyStatblocks"),
    reprintBehavior: v("reprintBehavior") || "newest",
    useDiceRoller: c("useDiceRoller"),
    tagPrefix: v("tagPrefix") || "ttrpg",
    templateRelativePath: TEMPLATES_REL,
    templates,
  };
}

function captureConfigFields() {
  const f: Record<string, string | boolean> = {};
  for (const k of CFG_KEYS) {
    const el = cfgEl(k) as HTMLInputElement;
    if (!el) continue;
    f[k] = el.type === "checkbox" ? el.checked : el.value;
  }
  state.configFields = f;
}
function applyConfigFields(f: Record<string, string | boolean>) {
  for (const k of CFG_KEYS) {
    const el = cfgEl(k) as HTMLInputElement;
    if (!el || !(k in f)) continue;
    if (el.type === "checkbox") el.checked = Boolean(f[k]);
    else el.value = String(f[k]);
  }
}
function refreshConfigPreview() {
  $("#config-preview").querySelector("code")!.textContent = buildConfigJson(readConfigInput());
  refreshStatblockNotice();
}

/** Configure-tab banner: make it obvious whether monsters will be Fantasy Statblocks or plain Markdown. */
function refreshStatblockNotice() {
  const el = $("#statblock-notice");
  const mt = (cfgEl("tpl_monster") as HTMLSelectElement)?.value ?? "";
  if (!mt) { el.hidden = true; return; }
  const g = conversionGuidance({ monsterTemplate: mt, diceRoller: false });
  el.hidden = false;
  if (g.usingStatblocks) {
    el.className = "notice ok";
    el.innerHTML = "✓ Monster notes will use <strong>Fantasy Statblocks</strong> — you'll need that plugin installed in Obsidian.";
  } else {
    el.className = "notice warn";
    el.innerHTML =
      "⚠ This monster template produces <strong>plain Markdown</strong>, not Fantasy Statblocks. " +
      "For Fantasy Statblocks, tick <strong>Fantasy Statblocks</strong> above and choose a monster template with " +
      "<code>statblock</code> in the name — or click <strong>Recommended</strong>.";
  }
}

document.querySelectorAll("[data-cfg]").forEach((el) =>
  el.addEventListener("input", () => {
    captureConfigFields();
    persist();
    refreshConfigPreview();
    if ((el as HTMLElement).getAttribute("data-cfg") === "useFantasyStatblocks") void refreshTemplates();
  }),
);

/* ---- template dropdowns ---- */
function tplPredicate(key: TemplateKey, fant: boolean): (name: string) => boolean {
  const k = key.toLowerCase();
  return (name) => {
    const l = name.toLowerCase();
    if (key === "monster") return l.includes("monster") && (fant ? l.includes("statblock") : !l.includes("statblock"));
    if (key === "class") return l.includes("class") && !l.includes("subclass");
    if (key === "subclass") return l.includes("subclass");
    return l.includes(k);
  };
}
/** The basic default template file for a key (used when nothing is chosen). */
function defaultTemplate(key: TemplateKey, fant: boolean, files: string[]): string {
  if (files.length === 0) return "";
  if (key === "monster") {
    const want = fant ? "monster2md-yamlStatblock-body.txt" : "monster2md.txt";
    if (files.includes(want)) return want;
  }
  const plain = `${key}2md.txt`;
  if (files.includes(plain)) return plain;
  // Prefer a plain variant over the "images-" ones, else just the first file.
  return files.find((f) => !f.toLowerCase().startsWith("images-")) ?? files[0];
}

function fillSelect(key: string, files: string[], def: string) {
  const sel = cfgEl(key) as HTMLSelectElement;
  const prev = state.configFields[key] as string | undefined;
  sel.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = ""; blank.textContent = "— none —";
  sel.appendChild(blank);
  for (const f of files) {
    const o = document.createElement("option");
    o.value = f; o.textContent = f;
    sel.appendChild(o);
  }
  // Keep a valid prior choice (including an explicit "none"); otherwise default
  // to a basic template file rather than leaving it blank.
  if (prev !== undefined && (prev === "" || files.includes(prev))) sel.value = prev;
  else sel.value = def;
}
async function refreshTemplates() {
  if (!state.cliHome) return;
  try {
    const fant = (cfgEl("useFantasyStatblocks") as HTMLInputElement)?.checked ?? false;
    for (const key of TEMPLATE_KEYS_5E) {
      const files = await listTemplates(state.cliHome, tplPredicate(key, fant));
      fillSelect(`tpl_${key}`, files, defaultTemplate(key, fant, files));
    }
    captureConfigFields();
    persist();
    refreshConfigPreview();
  } catch (e) {
    log(`Could not list templates: ${e}`);
  }
}
$("#refresh-templates").addEventListener("click", () => void refreshTemplates());

/* ---- recommended template preset ---- */
function recommendedTemplate(key: TemplateKey, fant: boolean, files: string[]): string {
  if (files.length === 0) return "";
  if (key === "monster") {
    if (fant && files.includes("monster2md-yamlStatblock-body.txt")) return "monster2md-yamlStatblock-body.txt";
    return ["images-monster2md.txt", "monster2md.txt"].find((f) => files.includes(f)) ?? files[0];
  }
  // Prefer the richer image-embedding variant, then the plain one.
  return [`images-${key}2md.txt`, `${key}2md.txt`].find((f) => files.includes(f)) ?? files[0];
}
async function applyRecommendedTemplates() {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  try {
    const fant = (cfgEl("useFantasyStatblocks") as HTMLInputElement)?.checked ?? false;
    let n = 0;
    for (const key of TEMPLATE_KEYS_5E) {
      const files = await listTemplates(state.cliHome, tplPredicate(key, fant));
      const rec = recommendedTemplate(key, fant, files);
      fillSelect(`tpl_${key}`, files, rec);
      (cfgEl(`tpl_${key}`) as HTMLSelectElement).value = rec; // force-override prior choice
      if (rec) n++;
    }
    captureConfigFields();
    persist();
    refreshConfigPreview();
    log(n > 0 ? `Applied recommended templates to ${n} type(s).` : "No templates found — run Get templates on Setup first.");
  } catch (e) { log(`Could not apply templates: ${e}`); }
}
$("#apply-recommended").addEventListener("click", () => void applyRecommendedTemplates());

/* ---- template guide modal ---- */
$("#template-guide-btn").addEventListener("click", () => (($("#guide-modal") as HTMLElement).hidden = false));
$("#guide-modal-close").addEventListener("click", () => (($("#guide-modal") as HTMLElement).hidden = true));
$("#guide-modal").addEventListener("click", (e) => {
  if (e.target === $("#guide-modal")) ($("#guide-modal") as HTMLElement).hidden = true;
});

/* ---- thank the developer modal ---- */
$("#thanks-btn").addEventListener("click", () => (($("#thanks-modal") as HTMLElement).hidden = false));
$("#thanks-modal-close").addEventListener("click", () => (($("#thanks-modal") as HTMLElement).hidden = true));
$("#thanks-modal").addEventListener("click", (e) => {
  if (e.target === $("#thanks-modal")) ($("#thanks-modal") as HTMLElement).hidden = true;
});

document.querySelectorAll<HTMLButtonElement>(".ext-link").forEach((b) =>
  b.addEventListener("click", () => { const u = b.dataset.url; if (u) openUrl(u).catch((e) => log(`${e}`)); }),
);

/* ---- Template Creator ---- */
const UNIVERSAL_VARS = ["resource.name", "resource.source", "resource.text", "resource.tags", "resource.aliases"];
const SNIPPETS: Record<string, string> = {
  frontmatter: "---\ncssclasses:\n- \ntags:\n{#for tag in resource.tags}- {tag}\n{/for}---\n",
  if: "{#if resource.field}\n\n{/if}\n",
  for: "{#for item in resource.list}\n- {item}\n{/for}\n",
  each: "{#each resource.list}\n{it}\n{/each}\n",
  image: "{#if resource.hasImages}{resource.showPortraitImage}{/if}\n{#if resource.hasMoreImages}\n{resource.showMoreImages}\n{/if}\n",
};
const creatorType = () => ($("#creator-type") as HTMLSelectElement).value as TemplateKey;

function insertAtCursor(text: string) {
  const ta = $("#creator-editor") as HTMLTextAreaElement;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  renderCreatorPreview();
}

/** All templates for a type, regardless of the Fantasy Statblocks toggle —
 *  the creator should surface every available variable, not just the selected variant's. */
function typeTemplatesPredicate(key: TemplateKey): (name: string) => boolean {
  const k = key.toLowerCase();
  return (name) => {
    const l = name.toLowerCase();
    if (key === "class") return l.includes("class") && !l.includes("subclass");
    if (key === "subclass") return l.includes("subclass");
    return l.includes(k);
  };
}

async function loadCreatorVars(type: TemplateKey) {
  let texts: string[] = [];
  if (state.cliHome) {
    try {
      const files = await listTemplates(state.cliHome, typeTemplatesPredicate(type));
      texts = await Promise.all(files.map((f) => readTemplate(state.cliHome!, f).catch(() => "")));
    } catch { /* fall through */ }
  }
  const joined = texts.join("\n").trim();
  creatorTreeEmpty = joined.length === 0;
  // Fall back to the universal fields if nothing is installed for this type.
  creatorTree = buildVariableTree(creatorTreeEmpty ? [UNIVERSAL_VARS.map((v) => `{${v}}`).join(" ")] : texts);
  renderCreatorTree();
}

function renderVarTree(nodes: VarNode[], filter: string, depth = 0): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "vt-list";
  for (const n of nodes) {
    const selfMatch = !filter || n.label.toLowerCase().includes(filter);
    const hasKids = !!(n.children && n.children.length);
    const childUl = hasKids ? renderVarTree(n.children!, filter, depth + 1) : null;
    const childMatch = !!childUl && childUl.childElementCount > 0;
    if (filter && !selfMatch && !childMatch) continue;

    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = `vt-row vt-${n.kind}` + (n.kind === "list" ? " vt-list-node" : "");

    if (hasKids) {
      const caret = document.createElement("span");
      caret.className = "vt-caret"; caret.textContent = "▸";
      row.appendChild(caret);
      // auto-open: top level always, and anything matching a filter
      if (filter || depth === 0) li.classList.add("open");
      row.addEventListener("click", () => li.classList.toggle("open"));
    } else {
      const dot = document.createElement("span"); dot.className = "vt-dot"; dot.textContent = "·";
      row.appendChild(dot);
    }

    const lbl = document.createElement("span");
    lbl.className = "vt-label"; lbl.textContent = n.label;
    row.appendChild(lbl);

    if (n.kind === "list") {
      const badge = document.createElement("span"); badge.className = "vt-badge"; badge.textContent = "list";
      row.appendChild(badge);
    }
    if (hasKids) {
      const count = document.createElement("span");
      count.className = "vt-count"; count.textContent = String(n.children!.length);
      row.appendChild(count);
    }

    if (n.kind === "scalar" && n.insert) {
      // leaf: clicking inserts the value
      row.classList.add("vt-clickable");
      row.title = n.hint ?? n.insert;
      row.addEventListener("click", () => insertAtCursor(n.insert!));
    } else if (n.insert) {
      // object/list branch: row toggles expand; a small button inserts the scaffold/block
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "vt-loop";
      btn.textContent = n.kind === "list" ? "+ loop" : "+ block";
      btn.title = n.hint ?? "insert";
      btn.addEventListener("click", (e) => { e.stopPropagation(); insertAtCursor(n.insert!); });
      row.appendChild(btn);
    }

    li.appendChild(row);
    if (childUl) li.appendChild(childUl);
    ul.appendChild(li);
  }
  return ul;
}
function renderCreatorTree() {
  const wrap = $("#creator-vars");
  wrap.innerHTML = "";
  if (creatorTreeEmpty) {
    const note = document.createElement("div");
    note.className = "palette-note";
    note.textContent = "Install templates on Setup to see this type's full variable list. Showing universal fields.";
    wrap.appendChild(note);
  }
  const filter = ($("#creator-search") as HTMLInputElement).value.trim().toLowerCase();
  wrap.appendChild(renderVarTree(creatorTree, filter));
}

async function loadCreatorStartFrom(type: TemplateKey) {
  const sel = $("#creator-startfrom") as HTMLSelectElement;
  sel.innerHTML = '<option value="">— blank —</option>';
  if (!state.cliHome) return;
  try {
    for (const f of await listTemplates(state.cliHome, typeTemplatesPredicate(type))) {
      const o = document.createElement("option"); o.value = f; o.textContent = f; sel.appendChild(o);
    }
  } catch { /* ignore */ }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inlineMd(s: string) {
  s = escapeHtml(s);
  s = s.replace(/!\[\[([^\]]+)\]\]/g, (_m, n) => `<span class="md-img">🖼 ${n}</span>`);
  s = s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_m, n, a) => `<span class="md-link">${a ? a.slice(1) : n}</span>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}
function mdToHtml(md: string) {
  let body = md, fmHtml = "";
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = md.slice(fm[0].length);
    const lines = fm[1].split("\n").filter((l) => l.trim());
    fmHtml = `<div class="md-fm">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>`;
  }
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^#{1,6}\s/.test(line)) { closeList(); const lvl = line.match(/^#+/)![0].length; out.push(`<h${lvl}>${inlineMd(line.replace(/^#+\s/, ""))}</h${lvl}>`); }
    else if (/^---+$/.test(line)) { closeList(); out.push("<hr/>"); }
    else if (/^\s*-\s+/.test(line)) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inlineMd(line.replace(/^\s*-\s+/, ""))}</li>`); }
    else if (line.trim() === "") { closeList(); }
    else { closeList(); out.push(`<p>${inlineMd(line)}</p>`); }
  }
  closeList();
  return fmHtml + out.join("\n");
}
function renderCreatorPreview() {
  const md = renderTemplatePreview(($("#creator-editor") as HTMLTextAreaElement).value, buildSample());
  $("#creator-preview").innerHTML = mdToHtml(md);
}

/** Auto-fill the file name to match the type, so the config dropdown will pick
 *  it up — but never overwrite a name the user has typed themselves. */
function suggestCreatorFilename() {
  const input = $("#creator-filename") as HTMLInputElement;
  const cur = input.value.trim();
  if (cur !== "" && cur !== creatorFilenameAuto) return; // user customised it; leave alone
  const fant = (cfgEl("useFantasyStatblocks") as HTMLInputElement)?.checked ?? false;
  const suggestion = suggestTemplateFilename(creatorType(), fant);
  input.value = suggestion;
  creatorFilenameAuto = suggestion;
}

async function onCreatorType() {
  const type = creatorType();
  suggestCreatorFilename();
  await Promise.all([loadCreatorVars(type), loadCreatorStartFrom(type)]);
  renderCreatorPreview();
}
function openCreator() {
  const typeSel = $("#creator-type") as HTMLSelectElement;
  if (!typeSel.options.length) {
    for (const k of TEMPLATE_KEYS_5E) { const o = document.createElement("option"); o.value = k; o.textContent = k; typeSel.appendChild(o); }
  }
  ($("#creator-modal") as HTMLElement).hidden = false;
  void onCreatorType();
}
async function saveCreatorTemplate() {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  let name = ($("#creator-filename") as HTMLInputElement).value.trim();
  if (!name) return log("Enter a file name for the template.");
  if (!/\.txt$/i.test(name)) name += ".txt";
  const type = creatorType();
  const fant = (cfgEl("useFantasyStatblocks") as HTMLInputElement)?.checked ?? false;
  const willShow = tplPredicate(type, fant)(name);
  try {
    await saveTemplate(state.cliHome, name, ($("#creator-editor") as HTMLTextAreaElement).value);
    log(`Saved template: ${name}`);
    // Preselect the new file in its dropdown so it's ready to use immediately.
    if (willShow) state.configFields[`tpl_${type}`] = name;
    await refreshTemplates();   // surface it in the config dropdowns
    if (!willShow) {
      const hint = suggestTemplateFilename(type, fant);
      log(`Heads up: "${name}" won't appear in the ${type} dropdown — the name must contain "${type}"` +
        (type === "monster" && fant ? ' and "statblock"' : "") + `. Try something like "${hint}".`);
    }
    creatorFilenameAuto = ""; // next new template gets a fresh suggestion
    await loadCreatorStartFrom(type);
  } catch (e) { log(`Could not save template: ${e}`); }
}

$("#open-creator").addEventListener("click", openCreator);
$("#creator-close").addEventListener("click", () => (($("#creator-modal") as HTMLElement).hidden = true));
$("#creator-modal").addEventListener("click", (e) => { if (e.target === $("#creator-modal")) ($("#creator-modal") as HTMLElement).hidden = true; });
$("#creator-type").addEventListener("change", () => void onCreatorType());
$("#creator-startfrom").addEventListener("change", async () => {
  const f = ($("#creator-startfrom") as HTMLSelectElement).value;
  if (f && state.cliHome) {
    try { ($("#creator-editor") as HTMLTextAreaElement).value = await readTemplate(state.cliHome, f); }
    catch (e) { log(`${e}`); }
  }
  renderCreatorPreview();
});
$("#creator-editor").addEventListener("input", renderCreatorPreview);
$("#creator-search").addEventListener("input", renderCreatorTree);
document.querySelectorAll<HTMLButtonElement>(".snip").forEach((b) =>
  b.addEventListener("click", () => insertAtCursor(SNIPPETS[b.dataset.snip ?? ""] ?? "")),
);
$("#creator-save").addEventListener("click", () => void saveCreatorTemplate());

/* ---- index picker ---- */
$("#generate-index").addEventListener("click", async () => {
  const status = $("#index-status");
  if (!state.exePath) { status.textContent = ""; return log("Install the converter first (Setup tab)."); }
  if (!state.dataFolder) { status.textContent = ""; return log("Clone the 5etools source data first (Setup tab)."); }
  if (!(await pathExists(state.exePath))) return log(`Converter not found at ${state.exePath}.`);
  status.textContent = "scanning…";
  log("Scanning data to build the index (no config — indexes everything)…");
  try {
    const code = await runConverter(state.exePath, ["--index", "-o", INDEX_OUT, state.dataFolder], state.cliHome, log);
    if (code !== 0) { status.textContent = "scan failed"; return log(`Index scan exited with code ${code}`); }
    indexKeys = await loadIndexKeys(state.cliHome, INDEX_OUT);
    status.textContent = `${indexKeys.length} keys ✓`;
    log(`Index ready: ${indexKeys.length} keys.`);
    renderIndexResults("");
  } catch (e) { status.textContent = "scan failed"; log(`Index scan failed: ${e}`); }
});

$("#load-index").addEventListener("click", async () => {
  const status = $("#index-status");
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  try {
    indexKeys = await loadIndexKeys(state.cliHome, INDEX_OUT);
    status.textContent = `${indexKeys.length} keys ✓`;
    log(`Loaded ${indexKeys.length} cached keys.`);
    renderIndexResults("");
  } catch {
    status.textContent = "no cached index";
    $("#index-results").innerHTML = '<span class="hint">No cached index yet. Click “Generate index”.</span>';
  }
});
$("#index-search").addEventListener("input", (e) => renderIndexResults((e.target as HTMLInputElement).value));

function renderIndexResults(query: string) {
  const box = $("#index-results");
  if (indexKeys.length === 0) { box.innerHTML = '<span class="hint">Generate or load the index to browse keys.</span>'; return; }
  const matches = filterKeys(indexKeys, query);
  box.innerHTML = "";
  for (const key of matches) {
    const row = document.createElement("div");
    row.className = "index-row";
    const span = document.createElement("span");
    span.textContent = key;
    const inc = document.createElement("button");
    inc.className = "btn ghost sm"; inc.textContent = "+ inc";
    inc.addEventListener("click", () => appendKey("include", key));
    const exc = document.createElement("button");
    exc.className = "btn ghost sm"; exc.textContent = "− exc";
    exc.addEventListener("click", () => appendKey("exclude", key));
    row.append(span, inc, exc);
    box.appendChild(row);
  }
  if (matches.length === 0) box.innerHTML = '<span class="hint">No matches.</span>';
}
function appendKey(field: "include" | "exclude", key: string) {
  const ta = cfgEl(field) as HTMLTextAreaElement;
  const lines = splitLines(ta.value);
  if (!lines.includes(key)) {
    ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + key;
    captureConfigFields();
    persist();
    refreshConfigPreview();
    log(`${field}: ${key}`);
  }
}

/* ---- source picker modal ---- */
let modalTarget: "adventure" | "book" | "reference" = "adventure";
let modalEntries: SourceEntry[] = [];
let pickerSelected = new Set<string>(); // live checkbox state (survives search filtering)
let pickerInitial = new Set<string>();  // snapshot at open — drives picked-to-top ordering
let homebrewEntries: HomebrewEntry[] = [];
let hbSelected = new Set<string>();      // live: selected homebrew paths
let hbInitial = new Set<string>();       // snapshot at open
let hbCatFilter = new Set<string>();     // active category chips (empty = all)

async function getSources(kind: "book" | "adventure"): Promise<SourceEntry[]> {
  if (sourceCache[kind]) return sourceCache[kind]!;
  const file = kind === "book" ? "books.json" : "adventures.json";
  const list = await loadSources(state.dataFolder, file, kind);
  sourceCache[kind] = list;
  return list;
}

async function openSourcePicker(target: "adventure" | "book" | "reference") {
  if (!state.dataFolder) return log("Clone the 5etools source data first (Setup tab).");
  modalTarget = target;
  try {
    if (target === "reference") {
      const [books, advs] = await Promise.all([getSources("book"), getSources("adventure")]);
      const seen = new Set<string>();
      modalEntries = [...books, ...advs].filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
      modalEntries.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      modalEntries = await getSources(target);
    }
  } catch (e) {
    return log(`Could not read sources (is the data cloned?): ${e}`);
  }
  $("#source-modal-title").textContent =
    `Pick ${target === "reference" ? "reference sources" : target === "book" ? "books" : "adventures"}`;
  pickerInitial = currentSelected();          // ordering snapshot (stable for this session)
  pickerSelected = new Set(pickerInitial);    // live edits
  ($("#source-search") as HTMLInputElement).value = "";
  renderSourceList("");
  ($("#source-modal") as HTMLElement).hidden = false;
}

function currentSelected(): Set<string> {
  return new Set(splitLines(((cfgEl(modalTarget) as HTMLInputElement).value).replace(/,/g, "\n")).map((s) => s.trim()).filter(Boolean));
}

function renderSourceList(query: string) {
  const q = query.trim().toLowerCase();
  const list = (q
    ? modalEntries.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
    : modalEntries.slice()
  ).sort((a, b) =>
    // already-picked (at open) float to the top; then alphabetical
    Number(pickerInitial.has(b.id)) - Number(pickerInitial.has(a.id)) || a.name.localeCompare(b.name),
  );
  const box = $("#source-list");
  box.innerHTML = "";
  for (const e of list) {
    const row = document.createElement("label");
    row.className = "source-row";
    if (pickerInitial.has(e.id)) row.classList.add("picked");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = e.id; cb.checked = pickerSelected.has(e.id);
    cb.addEventListener("change", () => {
      if (cb.checked) pickerSelected.add(e.id); else pickerSelected.delete(e.id);
    });
    const text = document.createElement("span");
    text.innerHTML = `${e.name} <em>${e.id}</em>`;
    row.append(cb, text);
    box.appendChild(row);
  }
  $("#source-count").textContent = `${list.length} shown`;
}

document.querySelectorAll<HTMLButtonElement>(".pick[data-pick]").forEach((b) =>
  b.addEventListener("click", () => void openSourcePicker(b.dataset.pick as "adventure" | "book" | "reference")),
);
$("#source-search").addEventListener("input", (e) => renderSourceList((e.target as HTMLInputElement).value));
$("#source-modal-close").addEventListener("click", () => (($("#source-modal") as HTMLElement).hidden = true));
$("#source-modal").addEventListener("click", (e) => {
  if (e.target === $("#source-modal")) ($("#source-modal") as HTMLElement).hidden = true;
});
$("#source-add").addEventListener("click", () => {
  const input = cfgEl(modalTarget) as HTMLInputElement;
  const known = new Set(modalEntries.map((e) => e.id));
  // Keep originals that are either manual (unknown to the picker) or still selected,
  // then append any newly-picked codes. Unticking a known source now removes it.
  const kept = toList(input.value).filter((c) => !known.has(c) || pickerSelected.has(c));
  for (const id of pickerSelected) if (!kept.includes(id)) kept.push(id);
  const before = toList(input.value).length;
  input.value = kept.join(", ");
  captureConfigFields();
  persist();
  refreshConfigPreview();
  ($("#source-modal") as HTMLElement).hidden = true;
  log(`${modalTarget}: ${kept.length} source(s) selected (was ${before})`);
});

/* ---- homebrew browser (categorised, mirrors the source picker) ---- */
function homebrewLines(): string[] {
  return ((cfgEl("homebrew") as HTMLTextAreaElement).value)
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function openHomebrewBrowser() {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  let rel: string[] = [];
  try {
    rel = await listHomebrew(state.cliHome);
  } catch (e) {
    return log(`Couldn't read the homebrew folder: ${e}`);
  }
  if (rel.length === 0) {
    return log("No homebrew files found — use “Get homebrew” on the Setup tab first.");
  }
  homebrewEntries = parseHomebrew(rel);
  hbInitial = new Set(homebrewLines());
  hbSelected = new Set(hbInitial);
  hbCatFilter = new Set();
  ($("#homebrew-search") as HTMLInputElement).value = "";
  renderHomebrewCats();
  renderHomebrewList("");
  ($("#homebrew-modal") as HTMLElement).hidden = false;
}

function homebrewQuery(): string {
  return ($("#homebrew-search") as HTMLInputElement).value;
}

/** Build the category filter chips (with counts) above the list. */
function renderHomebrewCats() {
  const groups = groupHomebrew(homebrewEntries);
  const bar = $("#homebrew-cats");
  bar.innerHTML = "";

  const chip = (label: string, active: boolean, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hb-chip" + (active ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    bar.appendChild(b);
  };

  chip(`All (${homebrewEntries.length})`, hbCatFilter.size === 0, () => {
    hbCatFilter.clear();
    renderHomebrewCats();
    renderHomebrewList(homebrewQuery());
  });
  for (const g of groups) {
    chip(`${g.category} (${g.entries.length})`, hbCatFilter.has(g.category), () => {
      if (hbCatFilter.has(g.category)) hbCatFilter.delete(g.category);
      else hbCatFilter.add(g.category);
      renderHomebrewCats();
      renderHomebrewList(homebrewQuery());
    });
  }
}

function renderHomebrewList(query: string) {
  const matching = homebrewEntries.filter(
    (e) => matchesQuery(e, query) && (hbCatFilter.size === 0 || hbCatFilter.has(e.category)),
  );
  // Picked-at-open entries float to the top, preserving category grouping below.
  const picked = matching.filter((e) => hbInitial.has(e.path)).sort((a, b) => a.title.localeCompare(b.title));
  const rest = matching.filter((e) => !hbInitial.has(e.path));
  const box = $("#homebrew-list");
  box.innerHTML = "";

  const addRow = (e: HomebrewEntry) => {
    const row = document.createElement("label");
    row.className = "source-row";
    if (hbInitial.has(e.path)) row.classList.add("picked");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = e.path; cb.checked = hbSelected.has(e.path);
    cb.addEventListener("change", () => {
      if (cb.checked) hbSelected.add(e.path); else hbSelected.delete(e.path);
    });
    const text = document.createElement("span");
    text.innerHTML = e.author
      ? `${escapeHtml(e.title)} <em>${escapeHtml(e.author)}</em>`
      : escapeHtml(e.title);
    row.append(cb, text);
    box.appendChild(row);
  };

  if (picked.length) {
    const head = document.createElement("div");
    head.className = "hb-cat";
    head.textContent = "Selected";
    box.appendChild(head);
    picked.forEach(addRow);
  }
  for (const group of groupHomebrew(rest)) {
    const head = document.createElement("div");
    head.className = "hb-cat";
    head.textContent = `${group.category} (${group.entries.length})`;
    box.appendChild(head);
    group.entries.forEach(addRow);
  }
  $("#homebrew-count").textContent = `${matching.length} shown · ${hbSelected.size} selected`;
}

$("#browse-homebrew").addEventListener("click", () => void openHomebrewBrowser());
$("#homebrew-search").addEventListener("input", (e) => renderHomebrewList((e.target as HTMLInputElement).value));
$("#homebrew-modal-close").addEventListener("click", () => (($("#homebrew-modal") as HTMLElement).hidden = true));
$("#homebrew-modal").addEventListener("click", (e) => {
  if (e.target === $("#homebrew-modal")) ($("#homebrew-modal") as HTMLElement).hidden = true;
});
$("#homebrew-add").addEventListener("click", () => {
  const input = cfgEl("homebrew") as HTMLTextAreaElement;
  const known = new Set(homebrewEntries.map((e) => e.path));
  // Keep lines that are manual (unknown to the browser) or still selected;
  // append newly-selected paths. Unticking a known entry removes it.
  const kept = homebrewLines().filter((p) => !known.has(p) || hbSelected.has(p));
  for (const p of hbSelected) if (!kept.includes(p)) kept.push(p);
  const before = homebrewLines().length;
  input.value = kept.join("\n");
  captureConfigFields();
  persist();
  refreshConfigPreview();
  ($("#homebrew-modal") as HTMLElement).hidden = true;
  log(`homebrew: ${kept.length} file(s) selected (was ${before})`);
});

$("#open-sourcemap-cfg").addEventListener("click", () =>
  openUrl("https://github.com/ebullient/ttrpg-convert-cli/blob/main/docs/sourceMap.md").catch((e) => log(`${e}`)));

/* ---- library status ---- */
const present: Record<string, boolean> = {};
const LIB_BTN: Record<string, string> = {
  cli: "#install-cli", data: "#clone-src", templates: "#get-templates",
  starter: "#get-starter", images: "#clone-img", homebrew: "#clone-homebrew",
};
const LIB_LABEL: Record<string, [string, string]> = {
  cli: ["Install", "Update"],
  data: ["Get data", "Update"],
  templates: ["Get templates", "Update"],
  starter: ["Install", "Reinstall"],
  images: ["Get images", "Update"],
  homebrew: ["Get homebrew", "Update"],
};
function setLibState(key: string, ok: boolean, detail?: string) {
  present[key] = ok;
  const s = $(`#state-${key}`);
  s.textContent = ok ? "✓" : "—";
  s.className = "lib-state" + (ok ? " ok" : "");
  if (detail) $(`#detail-${key}`).textContent = detail;
  const btn = $(LIB_BTN[key]);
  if (btn) {
    btn.textContent = LIB_LABEL[key][ok ? 1 : 0];
    // Present → solid amber "Update". Absent optional items stay de-emphasised.
    if (ok) btn.classList.remove("ghost");
    else if (key === "images" || key === "homebrew" || key === "starter") btn.classList.add("ghost");
  }
}
async function refreshLibrary() {
  if (!state.cliHome) return;
  const home = state.cliHome;

  // 1) Detect everything on disk first — pure reads, no writes. This must never
  //    be interrupted by a settings save, or later items get skipped.
  const found = await findConverter(home);
  const dataPath = joinHome(home, "5etools-src", "data");
  const dataOk = await pathExists(dataPath);
  const tplOk = await pathExists(joinHome(home, ...TEMPLATES_REL.split("/")));
  // Starter pack present if its signature monster template has been copied in.
  const starterOk = await pathExists(
    joinHome(home, ...TEMPLATES_REL.split("/"), "monster2md-properties-statblock.txt"),
  );
  const imgOk = await pathExists(joinHome(home, "5etools-img"));
  const hbOk = await pathExists(joinHome(home, "homebrew"));

  // 2) Update the whole UI from those reads.
  setLibState("cli", !!found, found ?? "not installed");
  setLibState("data", dataOk);
  setLibState("starter", starterOk);
  setLibState("templates", tplOk);
  setLibState("images", imgOk);
  setLibState("homebrew", hbOk);
  updateReadiness();

  // 3) Self-heal saved paths (writes), once, after the UI is already correct.
  let changed = false;
  if (found && found !== state.exePath) { state.exePath = found; changed = true; }
  else if (!found && state.exePath) { state.exePath = ""; changed = true; }
  if (dataOk && state.dataFolder !== dataPath) {
    state.dataFolder = dataPath;
    ($("#data-folder") as HTMLInputElement).value = dataPath;
    refreshCommandPreview();
    changed = true;
  }
  if (changed) {
    try { await saveState(state); } catch (e) { log(`(could not save settings: ${e})`); }
  }
}

/** Enable/disable actions based on their real prerequisites, with a reason. */
function updateReadiness() {
  const dataReady = !!present.data;
  document.querySelectorAll<HTMLButtonElement>(".pick[data-pick]").forEach((b) => {
    b.disabled = !dataReady;
    b.title = dataReady ? "" : "Clone the 5etools source data first (Setup tab)";
  });
  const hb = $("#browse-homebrew") as HTMLButtonElement;
  hb.disabled = !present.homebrew;
  hb.title = present.homebrew ? "" : "Get homebrew first (Setup tab)";
  const gi = $("#generate-index") as HTMLButtonElement;
  const idxReady = !!present.cli && !!present.data;
  gi.disabled = !idxReady;
  gi.title = idxReady ? "" : "Install the converter and clone the source data first (Setup tab)";
}

/* ---- setup actions ---- */
$("#pick-cli-home").addEventListener("click", async () => {
  const dir = await pickFolder("Select the CLI home folder");
  if (!dir) return;
  state.cliHome = dir;
  ($("#cli-home") as HTMLInputElement).value = dir;
  if (!state.configFields.internalRoot) (cfgEl("internalRoot") as HTMLInputElement).value = "5etools-img";
  persist();
  await refreshLibrary();
  await refreshTemplates();
  refreshCommandPreview();
});

function setupProgress(p: Progress) {
  const bar = $("#setup-progress") as HTMLProgressElement;
  bar.hidden = false;
  if (p.percent >= 0) bar.value = p.percent;
  if (p.phase === "done") setTimeout(() => (bar.hidden = true), 1000);
}

$("#install-cli").addEventListener("click", async () => {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  log(present.cli ? "Updating converter to the latest release…" : "Installing converter…");
  try {
    state.exePath = await installCli(state.cliHome, setupProgress);
    await saveState(state); // flush immediately so it survives a restart
    log(`Converter installed: ${state.exePath}`);
    await refreshLibrary();
  } catch (e) { log(`Install failed: ${e}`); }
});

$("#get-templates").addEventListener("click", async () => {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  log(present.templates ? "Updating templates (re-downloading examples.zip)…" : "Downloading templates (examples.zip)…");
  try {
    await installTemplates(state.cliHome, setupProgress);
    log("Templates ready.");
    await refreshLibrary();
    await refreshTemplates();
  } catch (e) { log(`Templates failed: ${e}`); }
});

$("#get-starter").addEventListener("click", async () => {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  if (!present.templates) log("Tip: run Get templates first so the starter templates sit alongside the full set.");
  try {
    const written = await installBundledAssets(state.cliHome);
    log(`Starter pack installed (${written.length} file(s)): Basic Test Config + custom property templates.`);
    log("Open the Configure tab, choose basic-test-config.json, or pick the new monster/spell/item templates.");
    await refreshLibrary();
    await refreshTemplates();
    await refreshConfigList();
  } catch (e) { log(`Starter pack failed: ${e}`); }
});

$("#clone-src").addEventListener("click", () => doRepo("data", "https://github.com/5etools-mirror-3/5etools-src", "5etools-src", true));
$("#clone-img").addEventListener("click", () => doRepo("images", "https://github.com/5etools-mirror-3/5etools-img", "5etools-img", false));
$("#clone-homebrew").addEventListener("click", () => doRepo("homebrew", "https://github.com/TheGiddyLimit/homebrew", "homebrew", false));

async function doRepo(item: string, repo: string, dir: string, isSource: boolean) {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  const repoDir = joinHome(state.cliHome, dir);
  let code: number;
  try {
    if (present[item]) {
      log(`git pull in ${dir} … (updating)`);
      code = await gitPull(repoDir, log);
    } else {
      log(`git clone ${repo} …  (large repos take a while)`);
      code = await gitClone(repo, state.cliHome, log);
    }
    if (code === 0) {
      log(present[item] ? "update complete ✓" : "clone complete ✓");
      if (isSource) {
        state.dataFolder = joinHome(state.cliHome, "5etools-src", "data");
        ($("#data-folder") as HTMLInputElement).value = state.dataFolder;
        delete sourceCache.book; delete sourceCache.adventure;
        persist();
        refreshCommandPreview();
        log(`Data folder set: ${state.dataFolder}`);
      }
      await refreshLibrary();
    } else log(`git exited with code ${code}`);
  } catch (e) { log(`git failed (is git installed?): ${e}`); }
}

$("#open-git").addEventListener("click", () => openUrl("https://git-scm.com/").catch((e) => log(`${e}`)));

/* ---- configure: build & save ---- */
$("#save-config").addEventListener("click", async () => {
  if (!state.cliHome) return log("Pick a CLI home folder first (Setup tab).");
  let name = ($("#config-name") as HTMLInputElement).value.trim() || "my-config.json";
  if (!name.toLowerCase().endsWith(".json")) name += ".json";
  state.configName = name;
  persist();
  try {
    const path = await writeConfigFile(state.cliHome, name, buildConfigJson(readConfigInput()));
    $("#config-path").textContent = `saved → ${path}`;
    log(`Saved config: ${path}`);
    await refreshConfigList();
  } catch (e) { log(`Save failed: ${e}`); }
});

/* ---- run ---- */
async function refreshConfigList() {
  if (!state.cliHome) return;
  try {
    const configs = await listConfigs(state.cliHome);

    const run = $("#run-config") as HTMLSelectElement;
    run.innerHTML = "";
    for (const c of configs) {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      run.appendChild(o);
    }
    if (configs.includes(state.configName)) run.value = state.configName;

    // Master selector on the Configure page: "— new config —" plus each file.
    const master = $("#config-select") as HTMLSelectElement;
    master.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = ""; blank.textContent = "— new config —";
    master.appendChild(blank);
    for (const c of configs) {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      master.appendChild(o);
    }
    master.value = configs.includes(state.configName) ? state.configName : "";

    setRunReady(configs.length > 0);
    refreshCommandPreview();
  } catch (e) { log(`Could not list configs: ${e}`); }
}

/** Load a saved config.json back into the Configure form for editing/reuse. */
async function loadConfigIntoForm(name: string) {
  if (!state.cliHome) return;
  try {
    const text = await readTextFile(joinHome(state.cliHome, name));
    const fields = configToFields(text);
    state.configFields = fields;
    applyConfigFields(fields);            // sets inputs incl. the FantStat toggle
    state.configName = name;
    ($("#config-name") as HTMLInputElement).value = name;
    await refreshTemplates();             // repopulate selects, then select parsed values
    refreshConfigPreview();
    persist();
    log(`Loaded config: ${name}`);
  } catch (e) { log(`Could not load ${name}: ${e}`); }
}

$("#config-select").addEventListener("change", () => {
  const name = ($("#config-select") as HTMLSelectElement).value;
  if (name) void loadConfigIntoForm(name);
});

const currentConfigName = () => ($("#run-config") as HTMLSelectElement).value || state.configName;

/** Build the "after it finishes" instructions from the config that will actually run. */
async function renderRunGuidance() {
  const box = $("#run-guidance");
  let mt = (cfgEl("tpl_monster") as HTMLSelectElement)?.value ?? "";
  let dice = (cfgEl("useDiceRoller") as HTMLInputElement)?.checked ?? false;
  const name = ($("#run-config") as HTMLSelectElement).value;
  if (name && state.cliHome) {
    try {
      const fields = configToFields(await readTextFile(joinHome(state.cliHome, name)));
      mt = String(fields.tpl_monster ?? mt);
      dice = !!fields.useDiceRoller;
    } catch { /* fall back to the form values */ }
  }
  const g = conversionGuidance({ monsterTemplate: mt, diceRoller: dice });

  const statusLine = g.usingStatblocks
    ? `<div class="g-status ok">✓ Monsters will be <strong>Fantasy Statblocks</strong> — install the plugin below.</div>`
    : mt
      ? `<div class="g-status warn">⚠ Monsters will be <strong>plain Markdown</strong>, not Fantasy Statblocks, with this config. Change the monster template on Configure if you want statblocks.</div>`
      : "";

  const homeLabel = state.cliHome ?? "your CLI home";
  const assetPath = (rel: string) => joinHome(homeLabel, ...rel.split("/").filter(Boolean));

  const plugin = (p: typeof g.plugins[number]) => `
    <li class="g-plugin">
      <div class="g-plugin-head">
        <span class="need ${p.need}">${p.need}</span>
        <button class="btn link sm ext-link g-plugin-name" data-url="${pluginUrl(p.id)}">${p.name} ↗</button>
      </div>
      <div class="g-plugin-note">${p.note}</div>
      ${p.setup ? `<ol class="g-setup">${p.setup.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>` : ""}
    </li>`;

  const asset = (a: typeof g.assets[number]) => `
    <li class="g-asset">
      <strong>${a.name}</strong> — ${a.note}<br>
      <span class="g-from">from <code>${escapeHtml(assetPath(a.from))}</code></span><br>
      <span class="g-to">→ ${escapeHtml(a.to)}</span>
    </li>`;

  box.innerHTML =
    statusLine +
    `<div class="g-sub">1 · Copy the notes in</div>` +
    `<ol class="g-steps">
       <li>Click <strong>Open output folder</strong>, then copy the generated folder into the <em>top level</em> of your Obsidian vault. Treat these as read-only — re-run to update.</li>
     </ol>` +
    `<div class="g-sub">2 · Install these plugins <span class="g-subhint">(Settings → Community Plugins → Browse, or click a name)</span></div>` +
    `<ul class="g-plugins">${g.plugins.map(plugin).join("")}</ul>` +
    `<div class="g-sub">3 · Copy these from the examples folder you downloaded</div>` +
    `<ul class="g-assets">${g.assets.map(asset).join("")}</ul>` +
    `<div class="g-sub">4 · Finish up</div>` +
    `<div class="g-status restart">↻ Once everything's installed and copied, <strong>restart Obsidian</strong> so it loads the plugins, CSS and new notes together.</div>` +
    `<div class="g-links">
       <button class="btn ghost sm ext-link" data-url="https://obsidianttrpgtutorials.com/Obsidian+TTRPG+Tutorials/Plugin+Tutorials/Community+Plugins/TTRPG-Convert-CLI/TTRPG-Convert-CLI+5e">Full vault setup guide ↗</button>
       <button class="btn ghost sm ext-link" data-url="https://github.com/ebullient/ttrpg-convert-cli/blob/main/README.md">Converter docs ↗</button>
     </div>`;
  box.querySelectorAll<HTMLButtonElement>(".ext-link").forEach((b) =>
    b.addEventListener("click", () => { const u = b.dataset.url; if (u) openUrl(u).catch((e) => log(`${e}`)); }),
  );
}

function runArgs(): string[] {
  const args: string[] = [];
  if (($("#opt-log") as HTMLInputElement).checked) args.push("--log");
  if (($("#opt-debug") as HTMLInputElement).checked) args.push("--debug");
  if (($("#opt-verbose") as HTMLInputElement).checked) args.push("-v");
  if (($("#opt-index") as HTMLInputElement).checked) args.push("--index");
  const out = ($("#output-folder") as HTMLInputElement).value.trim();
  if (out) args.push("-o", out);
  args.push("-c", currentConfigName());
  if (state.dataFolder) args.push(state.dataFolder);
  return args;
}
function refreshCommandPreview() {
  const pretty = runArgs().map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  $("#command-preview").querySelector("code")!.textContent = `ttrpg-convert ${pretty}`;
}
["#run-config", "#output-folder", "#opt-index", "#opt-log", "#opt-debug", "#opt-verbose"].forEach((id) =>
  $(id).addEventListener("input", () => {
    state.outputFolder = ($("#output-folder") as HTMLInputElement).value;
    persist();
    refreshCommandPreview();
    if (id === "#run-config") void renderRunGuidance();
  }),
);
$("#data-folder").addEventListener("input", (e) => {
  state.dataFolder = (e.target as HTMLInputElement).value;
  delete sourceCache.book; delete sourceCache.adventure;
  persist();
  refreshCommandPreview();
});

$("#run-cli").addEventListener("click", async () => {
  if (!state.exePath) return log("Install the converter first (Setup tab).");
  if (!state.dataFolder) return log("No data folder — clone the 5etools source, or fill it in.");
  if (!(await pathExists(state.exePath))) return log(`Converter not found at ${state.exePath} — reinstall on Setup.`);
  const args = runArgs();
  log(`Running (cwd=${state.cliHome}): ttrpg-convert ${args.join(" ")}`);
  try {
    const code = await runConverter(state.exePath, args, state.cliHome, log);
    log(code === 0 ? "Conversion complete ✓ — open the output folder to copy into your vault." : `Converter exited with code ${code}`);
  } catch (e) {
    const msg = String(e);
    log(`Run failed: ${msg}`);
    if (/bad cpu type|os error 86|exec format error/i.test(msg)) {
      log(
        "↳ That's an architecture mismatch — the converter binary doesn't match your CPU. " +
        "Delete the downloaded ttrpg-convert-cli-* folder in your CLI home and click Install again to fetch the correct build for your machine " +
        "(Apple Silicon Macs need the osx-aarch_64 build). As a stop-gap on a Mac you can install Rosetta with: softwareupdate --install-rosetta --agree-to-license",
      );
    }
  }
});

$("#open-output").addEventListener("click", () => {
  if (!state.cliHome) return;
  const out = ($("#output-folder") as HTMLInputElement).value.trim() || "generated";
  openPath(joinHome(state.cliHome, out)).catch((e) => log(`Could not open folder: ${e}`));
});

/* ---- update check (lightweight: notify only, manual download) ---- */
function showUpdateBanner(update: AppUpdate) {
  const banner = $("#update-banner") as HTMLElement;
  $("#update-banner-text").textContent =
    `Update available — ${update.tag}. You're on v${appVersion}.`;
  const dl = $("#update-download") as HTMLButtonElement;
  dl.onclick = () => openUrl(update.url || APP_RELEASES_PAGE).catch((e) => log(`${e}`));
  ($("#update-dismiss") as HTMLButtonElement).onclick = () => (banner.hidden = true);
  banner.hidden = false;
}

async function checkForUpdate() {
  try {
    appVersion = await getVersion();
  } catch {
    return; // not running under Tauri (e.g. dev preview) — skip silently
  }
  if (!appVersion) return; // no usable version → don't risk a false banner
  const update = await checkAppUpdate(appVersion);
  if (update) {
    log(`Update available: ${update.tag} (you're on v${appVersion}).`);
    showUpdateBanner(update);
  } else {
    log(`Up to date (v${appVersion}).`);
  }
}

/* ---- startup ---- */
async function init() {
  detectHost()
    .then((h) => ($("#host-label").textContent = `${h.os} · ${h.arch}`))
    .catch(() => ($("#host-label").textContent = "host unknown"));

  try { state = await loadState(); }
  catch (e) { log(`Could not load settings: ${e}`); state = { ...DEFAULT_STATE }; }

  ($("#theme-select") as HTMLSelectElement).value = state.theme;
  applyTheme(state.theme);

  ($("#cli-home") as HTMLInputElement).value = state.cliHome;
  ($("#output-folder") as HTMLInputElement).value = state.outputFolder || "generated";
  ($("#data-folder") as HTMLInputElement).value = state.dataFolder;
  ($("#config-name") as HTMLInputElement).value = state.configName;
  applyConfigFields(state.configFields);

  refreshConfigPreview();
  refreshCommandPreview();
  if (state.cliHome) {
    await refreshLibrary();
    await refreshTemplates();
    await refreshConfigList();
    // If an index already exists on disk, load it so the key picker is ready.
    try {
      indexKeys = await loadIndexKeys(state.cliHome, INDEX_OUT);
      $("#index-status").textContent = `${indexKeys.length} keys ✓ (cached)`;
      renderIndexResults("");
    } catch { /* no cached index yet — that's fine */ }
  }

  // Non-blocking: check GitHub for a newer release and surface a banner.
  void checkForUpdate();
}
void init();
