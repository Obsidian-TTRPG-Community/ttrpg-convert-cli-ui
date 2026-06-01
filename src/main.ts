/**
 * main.ts — controller for the download-once / run-many workflow, extended with
 * the full config-key set: content filters (include/exclude/excludePattern),
 * defaultSource overrides, racesAsSpecies / onlyReferencedTables, every 5e
 * template key, an index-driven key picker, and run-time log/debug/verbose flags.
 */
import { buildConfigJson, configToFields, TEMPLATE_KEYS_5E, type ConfigInput, type TemplateKey } from "./lib/config";
import {
  detectHost, pathExists, findConverter, installCli, installTemplates, runConverter, gitClone, gitPull,
  writeConfigFile, readTextFile, listTemplates, listConfigs, loadIndexKeys, loadSources,
  pickHomebrewFile, pickFolder, joinHome, TEMPLATES_REL, type Progress,
} from "./lib/cli";
import { filterKeys } from "./lib/index";
import { mergeCodes, type SourceEntry } from "./lib/sources";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { loadState, saveState, DEFAULT_STATE, type PersistedState, type Theme } from "./lib/settings";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
let state: PersistedState = { ...DEFAULT_STATE };
const persist = () => void saveState(state);
let indexKeys: string[] = []; // transient, from all-index.json
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
    if (tab.dataset.tab === "run") void refreshConfigList();
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
  ($("#source-search") as HTMLInputElement).value = "";
  renderSourceList("");
  ($("#source-modal") as HTMLElement).hidden = false;
}

function currentSelected(): Set<string> {
  return new Set(splitLines(((cfgEl(modalTarget) as HTMLInputElement).value).replace(/,/g, "\n")).map((s) => s.trim()).filter(Boolean));
}

function renderSourceList(query: string) {
  const selected = currentSelected();
  const q = query.trim().toLowerCase();
  const list = q
    ? modalEntries.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
    : modalEntries;
  const box = $("#source-list");
  box.innerHTML = "";
  for (const e of list) {
    const row = document.createElement("label");
    row.className = "source-row";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = e.id; cb.checked = selected.has(e.id);
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
  const picked = Array.from($("#source-list").querySelectorAll<HTMLInputElement>("input:checked")).map((c) => c.value);
  const input = cfgEl(modalTarget) as HTMLInputElement;
  input.value = mergeCodes(input.value, picked);
  captureConfigFields();
  persist();
  refreshConfigPreview();
  ($("#source-modal") as HTMLElement).hidden = true;
  log(`${modalTarget}: added ${picked.length} source(s)`);
});

/* ---- homebrew file picker ---- */
$("#pick-homebrew").addEventListener("click", async () => {
  if (!state.cliHome) return log("Pick a CLI home folder first.");
  const file = await pickHomebrewFile(state.cliHome);
  if (!file) return;
  // Prefer a path relative to home (forward slashes per the CLI's Windows note);
  // fall back to <parent>/<file> like the original tool.
  const fwd = file.replace(/\\/g, "/");
  const homeFwd = state.cliHome.replace(/\\/g, "/").replace(/\/+$/, "");
  let entry: string;
  if (fwd.toLowerCase().startsWith(homeFwd.toLowerCase() + "/")) {
    entry = fwd.slice(homeFwd.length + 1);
  } else {
    const parts = fwd.split("/");
    entry = `homebrew/${parts[parts.length - 2] ?? ""}/${parts[parts.length - 1]}`;
  }
  const input = cfgEl("homebrew") as HTMLInputElement;
  const have = input.value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!have.includes(entry)) have.push(entry);
  input.value = have.join(", ");
  captureConfigFields();
  persist();
  refreshConfigPreview();
  log(`homebrew: ${entry}`);
});

$("#open-sourcemap-cfg").addEventListener("click", () =>
  openUrl("https://github.com/ebullient/ttrpg-convert-cli/blob/main/docs/sourceMap.md").catch((e) => log(`${e}`)));

/* ---- library status ---- */
const present: Record<string, boolean> = {};
const LIB_BTN: Record<string, string> = {
  cli: "#install-cli", data: "#clone-src", templates: "#get-templates",
  images: "#clone-img", homebrew: "#clone-homebrew",
};
const LIB_LABEL: Record<string, [string, string]> = {
  cli: ["Install", "Update"],
  data: ["Get data", "Update"],
  templates: ["Get templates", "Update"],
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
    else if (key === "images" || key === "homebrew") btn.classList.add("ghost");
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
  const imgOk = await pathExists(joinHome(home, "5etools-img"));
  const hbOk = await pathExists(joinHome(home, "homebrew"));

  // 2) Update the whole UI from those reads.
  setLibState("cli", !!found, found ?? "not installed");
  setLibState("data", dataOk);
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
  const hb = $("#pick-homebrew") as HTMLButtonElement;
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
  } catch (e) { log(`Run failed: ${e}`); }
});

$("#open-output").addEventListener("click", () => {
  if (!state.cliHome) return;
  const out = ($("#output-folder") as HTMLInputElement).value.trim() || "generated";
  openUrl(joinHome(state.cliHome, out)).catch((e) => log(`Could not open folder: ${e}`));
});

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
}
void init();
