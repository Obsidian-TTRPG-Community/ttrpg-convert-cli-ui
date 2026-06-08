# Bundled starter assets

These files ship inside the app (declared under `bundle.resources` in
`tauri.conf.json`) and are copied into the user's **CLI home** folder by the
**Starter pack** button on the Setup tab (Rust command `install_bundled_assets`).

```
basic-test-config.json                 -> <home>/basic-test-config.json
templates/tools5e/*.txt                -> <home>/examples/templates/tools5e/
```

## basic-test-config.json

A small, ready-to-run "Basic Test Config": Lost Mine of Phandelver plus the 2024
core books (XMM/XPHB/XDMG), Fantasy Statblocks on, wired to the three custom
templates below. Good for a quick end-to-end conversion test.

## Custom templates

All three put **every key stat into the note's frontmatter properties** (so they
show in Obsidian's Properties view / are queryable by Dataview) and add a
`CLI-Image` property pointing at the note's primary image.

- `monster2md-properties-statblock.txt` — Fantasy Statblocks monster note. The
  `statblock` code block is placed **above** the body (description/environment),
  since the statblock is the most important part. `CLI-Image` uses the token
  image, falling back to the first portrait/fluff image.
- `spell2md-properties.txt` — spell note. `CLI-Image` uses the first fluff image.
- `item2md-properties.txt` — item note. `CLI-Image` uses the first fluff image.

The monster file name contains `statblock` so it appears in the Configure tab's
monster dropdown when **Fantasy Statblocks** is enabled.
