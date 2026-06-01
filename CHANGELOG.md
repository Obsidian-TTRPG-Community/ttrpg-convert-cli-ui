# Changelog

All notable changes are recorded here. The release workflow pulls the section
matching a tag (e.g. `v2.0.0`) into the GitHub release notes, ahead of the
auto-generated "What's Changed" list.

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
