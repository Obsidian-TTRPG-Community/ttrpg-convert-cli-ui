/**
 * cli.ts — frontend orchestration over the Rust commands and Tauri plugins.
 * Everything is organised around a single CLI-home folder; file I/O goes
 * through Rust (works on any drive, unlike the scope-bound JS fs plugin).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";
import { Command } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  selectAsset,
  LATEST_RELEASE_API,
  type HostInfo,
  type ReleaseAsset,
} from "./platform";
import { parseIndexKeys } from "./index";
import { parseSourceList, type SourceEntry } from "./sources";

export interface Progress {
  phase: string;
  percent: number;
  message: string;
}

export function detectHost(): Promise<HostInfo> {
  return invoke<HostInfo>("detect_host");
}

export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

/** Locate the converter executable under `home` on disk (null if absent). */
export function findConverter(home: string): Promise<string | null> {
  return invoke<string | null>("find_converter", { home });
}

/** Fetch the latest converter release assets. */
export async function fetchLatestRelease(): Promise<ReleaseAsset[]> {
  const res = await fetch(LATEST_RELEASE_API, {
    method: "GET",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = (await res.json()) as { assets: ReleaseAsset[] };
  return json.assets ?? [];
}

/** Install the native converter for this host into `home`. Returns exe path. */
export async function installCli(
  home: string,
  onProgress: (p: Progress) => void,
): Promise<string> {
  const host = await detectHost();
  const assets = await fetchLatestRelease();
  const match = selectAsset(assets, host);
  if (!match) {
    throw new Error(
      `No native build found for ${host.os}/${host.arch}. ` +
        `Fall back to the runner jar (needs Java 17 or 21).`,
    );
  }
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<Progress>("cli-install-progress", (e) => onProgress(e.payload));
    return await invoke<string>("install_cli", {
      url: match.asset.browser_download_url,
      destDir: home,
    });
  } finally {
    unlisten?.();
  }
}

/** Relative path (under home) where the converter's example templates land. */
export const TEMPLATES_REL = "examples/templates/tools5e";

/** Download & extract the converter's examples.zip (templates) into `home`. */
export async function installTemplates(
  home: string,
  onProgress: (p: Progress) => void,
): Promise<string> {
  const assets = await fetchLatestRelease();
  const asset = assets.find((a) => a.name.toLowerCase().includes("examples.zip"));
  if (!asset) throw new Error("No examples.zip asset in the latest release.");
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<Progress>("templates-progress", (e) => onProgress(e.payload));
    await invoke("download_extract", { url: asset.browser_download_url, destDir: home });
    return TEMPLATES_REL;
  } finally {
    unlisten?.();
  }
}

/** Run the converter, streaming each output line to `onLine`. cwd should be home. */
export async function runConverter(
  exePath: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
): Promise<number> {
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<string>("converter-output", (e) => onLine(e.payload));
    return await invoke<number>("run_converter", { exePath, args, cwd });
  } finally {
    unlisten?.();
  }
}

/** Shallow-clone a repo into `cwd`, streaming git output. */
export async function gitClone(
  repoUrl: string,
  cwd: string,
  onLine: (line: string) => void,
  depth = 1,
): Promise<number> {
  const cmd = Command.create("git", ["clone", "--depth", String(depth), repoUrl], { cwd });
  cmd.stdout.on("data", (l) => onLine(l));
  cmd.stderr.on("data", (l) => onLine(l)); // git progress is on stderr
  await cmd.spawn();
  return new Promise((resolve) => {
    cmd.on("close", (data: { code: number | null }) => resolve(data.code ?? -1));
  });
}

/** Update an existing clone with `git pull` (run inside the repo via -C). */
export async function gitPull(repoDir: string, onLine: (line: string) => void): Promise<number> {
  const cmd = Command.create("git", ["-C", repoDir, "pull"]);
  cmd.stdout.on("data", (l) => onLine(l));
  cmd.stderr.on("data", (l) => onLine(l));
  await cmd.spawn();
  return new Promise((resolve) => {
    cmd.on("close", (data: { code: number | null }) => resolve(data.code ?? -1));
  });
}

/** Write a config file directly into the home folder. Returns the full path. */
export async function writeConfigFile(home: string, name: string, text: string): Promise<string> {
  const path = joinHome(home, name);
  await invoke("write_text_file", { path, contents: text });
  return path;
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

/** Read & parse all-index.json from the output folder (after a --index run). */
export async function loadIndexKeys(home: string, outputFolder: string): Promise<string[]> {
  const path = joinHome(home, outputFolder, "all-index.json");
  const text = await readTextFile(path); // throws if not present
  return parseIndexKeys(text);
}

/** Read available sources (books or adventures) from the cloned data folder. */
export async function loadSources(
  dataFolder: string,
  file: "books.json" | "adventures.json",
  key: "book" | "adventure",
): Promise<SourceEntry[]> {
  const path = joinHome(dataFolder, file);
  const text = await readTextFile(path);
  return parseSourceList(text, key);
}

/** Open a JSON file picker rooted at the homebrew folder. Returns absolute path. */
export async function pickHomebrewFile(home: string): Promise<string | null> {
  const result = await openDialog({
    multiple: false,
    title: "Select a homebrew JSON file",
    defaultPath: joinHome(home, "homebrew"),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof result === "string" ? result : null;
}

/** List *.txt template files under home/TEMPLATES_REL filtered by predicate. */
export async function listTemplates(
  home: string,
  matches: (name: string) => boolean,
): Promise<string[]> {
  const dir = joinHome(home, TEMPLATES_REL.replace(/\//g, sep(home)));
  const files = await invoke<string[]>("list_files", { dir, ext: ".txt" });
  return files.filter(matches);
}

/** List *.json config files sitting directly in the home folder. */
export function listConfigs(home: string): Promise<string[]> {
  return invoke<string[]>("list_files", { dir: home, ext: ".json" });
}

/** Native folder picker. */
export async function pickFolder(title = "Select a folder"): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

/* path helpers (separator inferred from the home path) */
function sep(base: string): string {
  return base.includes("\\") ? "\\" : "/";
}
export function joinHome(base: string, ...parts: string[]): string {
  const s = sep(base);
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(s);
}
