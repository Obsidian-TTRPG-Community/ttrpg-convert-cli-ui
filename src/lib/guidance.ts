/**
 * guidance.ts — derive post-conversion "what to do next" guidance from the
 * user's actual config choices (which monster template, dice roller, etc.).
 *
 * The key one: the default monster templates emit plain Markdown, NOT Fantasy
 * Statblocks. Only a template with "statblock" in the name produces the
 * Fantasy Statblocks block — a very common point of confusion.
 *
 * Plugin pages live at https://community.obsidian.md/plugins/<id>.
 */
export type Need = "required" | "recommended" | "optional";
export interface PluginNeed {
  id: string;          // Obsidian community plugin id (→ community.obsidian.md/plugins/<id>)
  name: string;
  need: Need;
  note: string;
  setup?: string[];    // post-install configuration steps
}
/** A file asset bundled in the downloaded examples folder that needs copying into the vault. */
export interface AssetNeed { name: string; from: string; to: string; note: string; }
export interface Guidance {
  usingStatblocks: boolean;
  /** A monster template is chosen but it produces plain Markdown (no statblocks). */
  mismatch: boolean;
  plugins: PluginNeed[];
  assets: AssetNeed[];
}

export function pluginUrl(id: string): string {
  return `https://community.obsidian.md/plugins/${id}`;
}

export function conversionGuidance(o: { monsterTemplate: string; diceRoller: boolean }): Guidance {
  const mt = (o.monsterTemplate || "").toLowerCase();
  const hasMonster = mt.length > 0;
  const usingStatblocks = mt.includes("statblock");
  const mismatch = hasMonster && !usingStatblocks;

  const plugins: PluginNeed[] = [
    {
      id: "obsidian-admonition", name: "Admonitions", need: "recommended",
      note: "Several notes use callout/admonition blocks. The plugin needs its definitions and CSS from the examples folder (below) to display them correctly.",
    },
  ];
  if (usingStatblocks) {
    plugins.push({
      id: "obsidian-5e-statblocks", name: "Fantasy Statblocks", need: "required",
      note: "Your monster template outputs a Fantasy Statblocks block, which only renders with this plugin installed.",
      setup: [
        "Open Settings \u2192 Fantasy Statblocks \u2192 Note Parsing.",
        "Enable \u201CAutomatically Parse Frontmatter for Creatures\u201D.",
        "Set \u201CBestiary Folder\u201D to the folder you copied the notes into \u2014 this stops it scanning your whole vault and keeps Obsidian fast to start.",
      ],
    });
    plugins.push({
      id: "initiative-tracker", name: "Initiative Tracker", need: "optional",
      note: "Statblocks include an \u201Cadd to encounter\u201D button this plugin powers.",
      setup: ["Settings \u2192 Initiative Tracker \u2192 Plugin Integrations: enable \u201CSync Monsters from TTRPG Statblocks\u201D."],
    });
  }
  if (o.diceRoller) {
    plugins.push({
      id: "obsidian-dice-roller", name: "Dice Roller", need: "recommended",
      note: "You enabled Dice Roller output, so the inline rolls in the notes need this plugin to be clickable.",
    });
  }

  const assets: AssetNeed[] = [
    {
      name: "Admonition definitions",
      from: "examples/admonitions/",
      to: "Admonitions plugin \u2192 Settings \u2192 \u201CImport Admonition(s)\u201D \u2192 pick the .json",
      note: "Registers the custom callout types the notes use.",
    },
    {
      name: "CSS snippets",
      from: "examples/css-snippets/",
      to: "<your vault>/.obsidian/snippets/ \u2014 then enable each under Settings \u2192 Appearance \u2192 CSS snippets",
      note: "Styling for statblocks, callouts and tables. Copy the .css files you want.",
    },
  ];

  return { usingStatblocks, mismatch, plugins, assets };
}
