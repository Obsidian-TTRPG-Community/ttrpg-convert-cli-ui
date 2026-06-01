# TTRPG Convert CLI UI

A cross-platform (Windows · macOS · Linux) rewrite of the original Windows-only
WinForms UI for [ttrpg-convert-cli](https://github.com/ebullient/ttrpg-convert-cli),
built on **Tauri 2** (Rust core + TypeScript frontend).

## Install

Grab the installer for your OS from the [Releases](../../releases) page:

- **Windows** — `.msi` or `.exe`. Unsigned, so SmartScreen warns on first run —
  see [Windows: "protected your PC"](#windows-protected-your-pc) below.
- **macOS** — `.dmg` (Apple Silicon or Intel — pick yours). The app isn't
  signed with an Apple Developer certificate, so macOS may block it on first
  launch — see [macOS: "app is damaged"](#macos-app-is-damaged) below.
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

- **macOS builds are unsigned** (no Apple Developer cert). They're ad-hoc signed
  in CI so the OS shows the normal "unidentified developer" gate rather than a
  hard error, but quarantine can still block first launch — see below.
- **Windows builds are unsigned** (no code-signing certificate) — SmartScreen
  warns on first run; see below. A certificate (paid) is the only thing that
  removes it; not currently set up.

### macOS: "app is damaged"

If macOS says the app *"is damaged and can't be opened"* (most common on Apple
Silicon) or *"can't be opened because it is from an unidentified developer"*,
that's Gatekeeper quarantining an unsigned download — the app is fine. Clear the
quarantine flag from Terminal (adjust the path to wherever the app is):

```sh
xattr -cr "/Applications/TTRPG Convert CLI UI.app"
```

Then open it normally. Proper Apple notarisation (which removes this entirely)
needs a paid Apple Developer account and is a possible future addition.

### Windows: "protected your PC"

Because the app isn't signed with a code-signing certificate, Windows SmartScreen
shows a blue *"Windows protected your PC"* dialog the first time you run the
installer. The app is fine — click **More info**, then **Run anyway**. Your
browser may also flag the download as uncommon; choose **Keep**. A code-signing
certificate (paid, and reputation builds over time) is the only thing that
removes this, and isn't currently set up.
- **PF2e is not yet supported** — the tool currently targets the 5etools data
  source and `tools5e` templates. Pathfinder support is a possible future addition.
