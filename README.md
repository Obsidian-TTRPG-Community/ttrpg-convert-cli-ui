# TTRPG Convert CLI UI

A cross-platform (Windows · macOS · Linux) rewrite of the original Windows-only
WinForms UI for [ttrpg-convert-cli](https://github.com/ebullient/ttrpg-convert-cli),
built on **Tauri 2** (Rust core + TypeScript frontend).

## Install

Grab the installer for your OS from the [Releases](../../releases) page:

- **Windows** — `.msi` or `.exe`
- **macOS** — `.dmg` (unsigned: right-click → **Open** the first time). Pick the
  Apple Silicon or Intel build for your Mac.
- **Linux** — `.AppImage` or `.deb`

No Java needed — on first launch the app downloads the `ttrpg-convert-cli`
binary for your OS, and you point it at your 5etools data from the Setup tab.

> 🚀 Respect copyrights — only convert sources you own.

## Workflow: download once, run many

Everything lives under one **CLI home** folder and is fetched a single time:

```
<home>/…/bin/ttrpg-convert(.exe)     the converter        (Install, Setup tab)
<home>/5etools-src/data              source data          (Get data — git clone)
<home>/examples/templates/tools5e/   templates            (Get templates — examples.zip)
<home>/5etools-img                   images (optional)    (Get images — git clone)
<home>/homebrew                      homebrew (optional)  (Get homebrew — git clone)
<home>/<name>.json                   your config files    (Build & Save, Configure tab)
<home>/<output>/                     generated notes      (Run tab)
```

The **Setup** tab shows a persistent library status (✓ when something is present
on disk), so reopening the app shows what's already downloaded. **Configure**
builds and saves named config files. **Run** picks a saved config and invokes the
converter with the working directory set to home — so the config name, data
folder, and output folder all resolve relative to it, exactly like the original.

## Architecture

The Rust layer (`src-tauri/src/lib.rs`) owns the jobs JS handles poorly or is
sandbox-blocked from. Crucially, file I/O runs through Rust (`write_text_file`,
`read_text_file`, `list_files`, `path_exists`) because Rust's `std::fs` is not
subject to the JS filesystem plugin's path scope — that scope was why saving a
config to a `D:\` folder silently failed in the first cut.

| Concern | Where |
| --- | --- |
| OS/arch detection, asset selection | `detect_host` + `src/lib/platform.ts` (**tested**) |
| Download + extract (converter & templates) | `install_cli`, `download_extract` |
| Run the converter, stream output | `run_converter` |
| Write/read/list config files, check paths | `write_text_file`, `read_text_file`, `list_files`, `path_exists` |
| `git clone` | shell plugin (`src/lib/cli.ts`) |
| Build `config.json` | `src/lib/config.ts` (**tested**, 1:1 with the VB `BuildConfigFile`) |
| Persisted settings | store plugin (`src/lib/settings.ts`) |

## Tested

- ✅ Core logic — **39 passing vitest tests** across the config builder + reverse
  parser, platform/asset matching, and the index and source parsers.
- ✅ Whole frontend typechecks (`npx tsc --noEmit`).
- ⚙️ Rust backend + Tauri wiring compiled and iterated on Windows during
  development; the release workflow builds all four targets.

## Build & run

Prereqs: Node 20+, Rust (stable) with the MSVC toolchain on Windows, and the
[Tauri system deps](https://tauri.app/start/prerequisites/). Icons are bundled
under `src-tauri/icons/`.

```bash
npm install
npm test            # verified logic tests
npm run tauri dev   # live dev window
npm run tauri build # installers in src-tauri/target/release/bundle/
```

Releasing: push a `vX.Y.Z` tag; the matrix workflow builds all four targets and
attaches them to a GitHub release with auto-generated notes. See `CHANGELOG.md`.

## Notes & limitations

- **macOS builds are unsigned** (no Apple Developer cert) — first launch needs
  right-click → **Open**. Notarisation is a separate setup if wanted.
- **PF2e is not yet supported** — the tool currently targets the 5etools data
  source and `tools5e` templates. Pathfinder support is a possible future addition.
