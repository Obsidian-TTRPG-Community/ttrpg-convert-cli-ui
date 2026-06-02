import { describe, it, expect } from "vitest";
import { conversionGuidance, pluginUrl } from "../guidance";

const names = (g: ReturnType<typeof conversionGuidance>) => g.plugins.map((p) => p.name);

describe("conversionGuidance", () => {
  it("flags a mismatch for a plain monster template", () => {
    const g = conversionGuidance({ monsterTemplate: "images-monster2md.txt", diceRoller: false });
    expect(g.usingStatblocks).toBe(false);
    expect(g.mismatch).toBe(true);
    expect(names(g)).not.toContain("Fantasy Statblocks");
  });
  it("requires Fantasy Statblocks for a statblock template", () => {
    const g = conversionGuidance({ monsterTemplate: "monster2md-yamlStatblock-body.txt", diceRoller: false });
    expect(g.usingStatblocks).toBe(true);
    expect(g.mismatch).toBe(false);
    const fs = g.plugins.find((p) => p.name === "Fantasy Statblocks");
    expect(fs?.need).toBe("required");
    expect(names(g)).toContain("Initiative Tracker");
  });
  it("adds Dice Roller only when enabled", () => {
    expect(names(conversionGuidance({ monsterTemplate: "", diceRoller: true }))).toContain("Dice Roller");
    expect(names(conversionGuidance({ monsterTemplate: "", diceRoller: false }))).not.toContain("Dice Roller");
  });
  it("no mismatch when no monster template is set", () => {
    const g = conversionGuidance({ monsterTemplate: "", diceRoller: false });
    expect(g.mismatch).toBe(false);
    expect(g.usingStatblocks).toBe(false);
  });
  it("always recommends Admonitions", () => {
    expect(names(conversionGuidance({ monsterTemplate: "", diceRoller: false }))).toContain("Admonitions");
  });
  it("carries community plugin ids and builds the page url", () => {
    const g = conversionGuidance({ monsterTemplate: "monster2md-yamlStatblock-body.txt", diceRoller: true });
    const fs = g.plugins.find((p) => p.name === "Fantasy Statblocks")!;
    expect(fs.id).toBe("obsidian-5e-statblocks");
    expect(pluginUrl(fs.id)).toBe("https://community.obsidian.md/plugins/obsidian-5e-statblocks");
    expect(g.plugins.find((p) => p.name === "Dice Roller")?.id).toBe("obsidian-dice-roller");
  });
  it("gives Fantasy Statblocks folder-parsing setup steps", () => {
    const g = conversionGuidance({ monsterTemplate: "monster2md-yamlStatblock-body.txt", diceRoller: false });
    const fs = g.plugins.find((p) => p.name === "Fantasy Statblocks")!;
    expect(fs.setup?.some((s) => /Bestiary Folder/.test(s))).toBe(true);
  });
  it("lists the example-folder assets (CSS snippets + admonitions)", () => {
    const g = conversionGuidance({ monsterTemplate: "", diceRoller: false });
    const froms = g.assets.map((a) => a.from);
    expect(froms).toContain("examples/css-snippets/");
    expect(froms).toContain("examples/admonitions/");
  });
});
