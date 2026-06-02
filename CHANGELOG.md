# Changelog

All notable changes are recorded here. The release workflow pulls the section
matching a tag (e.g. `v2.0.0`) into the GitHub release notes, ahead of the
auto-generated "What's Changed" list.

## v2.1.0 — Template Creator, guided setup & Apple Silicon fix

Everything since 2.0.1. Headline additions are the **Template Creator** and a
guided **post-conversion checklist**, plus an important Apple Silicon fix.

### Templates
- **Template Creator** (new) — a builder for authoring Qute templates without
  writing the syntax by hand, opened from the Templates section. A searchable
  side-panel lists the variables your *installed* templates actually expose, so
  they're always valid: objects expand (e.g. `scores` → `dex`, `dexMod`), arrays
  expand to their item fields (e.g. `action` → `name`, `desc`) with a one-click
  loop scaffold, and there's an image-block insert. Snippet buttons for
  frontmatter / `{#if}` / `{#for}` / `{#each}`, a "Start from" picker to base a
  new template on an existing one, a live (approximate, clearly-labelled)
  preview, and Save straight into your templates folder.
- **Template guide** (new) — an in-app reference for the template language:
  the keys, file-naming, a Qute syntax cheatsheet, and links to the official and
  community docs.
- **Recommended** button — fills every template type with a sensible default
  from your installed templates in one click.

### Run — guided next steps
- New **"After it finishes"** panel that adapts to your config: copy-into-vault
  steps; the plugins to install (linked to community.obsidian.md) with
  required / recommended / optional badges; the Fantasy Statblocks
  folder-parsing setup; and exactly which files from the downloaded examples
  folder (CSS snippets, admonition definitions) to copy and where. Ends by
  prompting an Obsidian restart.
- A clear warning — on both Configure and Run — when the chosen monster template
  will produce plain Markdown instead of Fantasy Statblocks, with how to switch.

### Updates
- The app now **checks for new releases on launch** and shows a dismissible
  banner ("Update available — vX.Y.Z") with a Download button to the releases
  page when a newer stable version is published. The check is silent on failure
  and never blocks startup; prereleases don't trigger it.

### Fixes
- **Homebrew filenames containing commas no longer break conversion.** The
  homebrew list was comma-delimited internally, so a filename with a comma in it
  (common for third-party titles, e.g. *"Flee, Mortals!.json"*) was split into a
  broken path the converter couldn't open — it failed with a NullPointerException
  before writing any output. Homebrew is now newline-delimited (one path per
  line), and existing configs broken by the old behaviour are repaired
  automatically when loaded in Configure.
- **Apple Silicon Macs now download the correct converter.** The arm64 build is
  published as `osx-aarch_64` (underscore), which the asset matcher didn't
  recognise — so Apple Silicon machines were getting the Intel binary and
  failing with *"Bad CPU type in executable"*. Added the classifier, plus
  runtime (Rosetta-aware) architecture detection, and an actionable log message
  if a mismatched binary is ever run.
- **Open output folder** now works reliably — it no longer routes through a
  URL-only handler that rejected local file paths.
- **Source pickers**: unticking a source now removes it, and already-picked
  sources sort to the top when you reopen the picker.

### Configure
- `defaultSource` overrides moved into the Advanced section alongside the source
  index and content filters, with a note on the 2024-only use case.

## v2.0.0 — Cross-platform rewrite

A ground-up, cross-platform rebuild of the Windows-only TTRPG_CLI_UI as a
Tauri 2 desktop app (Windows, macOS, Linux) that wraps
[`ttrpg-convert-cli`](https://github.com/ebullient/ttrpg-convert-cli). No Java
required — the converter binary is fetched for your OS on first run.

### Setup
- One "CLI home" folder holds everything (converter, data, templates, images,
  homebrew, configs, output).
- Library panel installs/updates each piece, detecting what's already on disk
  and switching Install -> Update accordingly (git `pull` for cloned repos,
  re-download for the converter and templates).

### Configure
- Full config-key coverage: sources, Obsidian output paths, images, reprint
  behaviour, tag prefix, dice roller, Fantasy Statblocks, races-as-species,
  only-referenced-tables, and `defaultSource` overrides.
- Source pickers read the cloned data's `books.json` / `adventures.json` so you
  choose sources by name instead of typing codes.
- Homebrew file picker rooted at the homebrew folder.
- Advanced (collapsible) content filters: include / exclude / excludePattern,
  with an index-driven key picker (Generate index -> click keys into the lists).
- All 16 template keys, each defaulting to a sensible template
  (`monster2md-yamlStatblock-body.txt` when Fantasy Statblocks is on).
- Master selector to load any saved config back into the form for reuse, and a
  live `config.json` preview.

### Run
- Config dropdown, output/data folders, and `--index` / `--log` / `--debug` /
  `-v` flags with a live command preview. The Run tab unlocks once a config
  exists.

### Misc
- Theme support: System / Light / Dark / Obsidian, remembered between sessions.
- Resizable output log.
- Tested core (config builder, reverse parser, platform/asset matching, index
  and source parsing).
