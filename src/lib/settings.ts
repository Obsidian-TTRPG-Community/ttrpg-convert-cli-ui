/**
 * settings.ts — persists wizard state across sessions via the Tauri store
 * plugin (a JSON file in the app config dir, auto-saved on write).
 *
 * Everything the user shouldn't have to re-enter lives here: the CLI home,
 * the installed converter path, the saved config path, the output and data
 * folders, and the config form field values.
 */
import { load, type Store } from "@tauri-apps/plugin-store";

export type Theme = "system" | "light" | "dark" | "obsidian";

export interface PersistedState {
  cliHome: string;
  exePath: string;
  configName: string;
  outputFolder: string;
  dataFolder: string;
  theme: Theme;
  /** Raw values of every [data-cfg] form control, keyed by its data-cfg name. */
  configFields: Record<string, string | boolean>;
}

export const DEFAULT_STATE: PersistedState = {
  cliHome: "",
  exePath: "",
  configName: "my-config.json",
  outputFolder: "generated",
  dataFolder: "",
  theme: "system",
  configFields: {},
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    // autoSave persists after each `set`, so a crash never loses settings.
    store = await load("settings.json", { autoSave: true, defaults: {} });
  }
  return store;
}

/** Load persisted state, merged over defaults so new keys are always present. */
export async function loadState(): Promise<PersistedState> {
  const s = await getStore();
  const saved = (await s.get<PersistedState>("state")) ?? null;
  return { ...DEFAULT_STATE, ...(saved ?? {}), configFields: saved?.configFields ?? {} };
}

/** Persist the whole state object, flushing to disk immediately. */
export async function saveState(state: PersistedState): Promise<void> {
  const s = await getStore();
  await s.set("state", state);
  await s.save(); // explicit flush — don't rely on autoSave debounce
}

/** Cross-platform join that respects the separator already in `base`. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  return [trimmed, ...parts].join(sep);
}
