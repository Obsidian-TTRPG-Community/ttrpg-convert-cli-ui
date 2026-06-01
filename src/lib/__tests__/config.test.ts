import { describe, it, expect } from "vitest";
import { buildConfig, buildConfigJson, configToFields, toList, type ConfigInput } from "../config";

function base(overrides: Partial<ConfigInput> = {}): ConfigInput {
  return {
    sources: { adventure: "", book: "", reference: "", homebrew: "" },
    paths: { rules: "rules", compendium: "compendium" },
    images: { copyInternal: true, copyExternal: false, internalRoot: "5etools-img" },
    useFantasyStatblocks: false,
    reprintBehavior: "newest",
    useDiceRoller: false,
    tagPrefix: "ttrpg",
    templateRelativePath: "examples/templates/tools5e",
    templates: { background: "images-background2md.txt", monster: "monster2md.txt" },
    ...overrides,
  };
}

describe("toList", () => {
  it("splits and trims", () => expect(toList("LMoP, PotA ,WBtW")).toEqual(["LMoP", "PotA", "WBtW"]));
  it("empty -> []", () => expect(toList("  ")).toEqual([]));
});

describe("sources", () => {
  it("emits empty arrays when nothing given", () => {
    expect(buildConfig(base()).sources).toEqual({ adventure: [], book: [], reference: [], homebrew: [] });
  });
  it("includes defaultSource only when non-empty", () => {
    expect((buildConfig(base()).sources as any).defaultSource).toBeUndefined();
    const c = buildConfig(base({ sources: { adventure: "", book: "", reference: "", homebrew: "", defaultSource: { monster: "XMM" } } }));
    expect((c.sources as any).defaultSource).toEqual({ monster: "XMM" });
  });
});

describe("content filters", () => {
  it("omits include/exclude/excludePattern when empty", () => {
    const c = buildConfig(base());
    expect(c.include).toBeUndefined();
    expect(c.exclude).toBeUndefined();
    expect(c.excludePattern).toBeUndefined();
  });
  it("emits them when populated", () => {
    const c = buildConfig(base({
      include: ["race|changeling|mpmm"],
      exclude: ["monster|expert|dc", "monster|expert|sdw"],
      excludePattern: ["race\\|.*\\|dmg"],
    }));
    expect(c.include).toEqual(["race|changeling|mpmm"]);
    expect(c.exclude).toHaveLength(2);
    expect(c.excludePattern).toEqual(["race\\|.*\\|dmg"]);
  });
});

describe("boolean toggles", () => {
  it("racesAsSpecies only when true", () => {
    expect(buildConfig(base()).racesAsSpecies).toBeUndefined();
    expect(buildConfig(base({ racesAsSpecies: true })).racesAsSpecies).toBe(true);
  });
  it("onlyReferencedTables only when true", () => {
    expect(buildConfig(base()).onlyReferencedTables).toBeUndefined();
    expect(buildConfig(base({ onlyReferencedTables: true })).onlyReferencedTables).toBe(true);
  });
  it("yamlStatblocks only when Fantasy Statblocks on", () => {
    expect(buildConfig(base()).yamlStatblocks).toBeUndefined();
    expect(buildConfig(base({ useFantasyStatblocks: true })).yamlStatblocks).toBe(true);
  });
});

describe("templates", () => {
  it("emits only chosen keys, joined to the relative path", () => {
    const t = buildConfig(base()).template as Record<string, string>;
    expect(t).toEqual({
      background: "examples/templates/tools5e/images-background2md.txt",
      monster: "examples/templates/tools5e/monster2md.txt",
    });
  });
  it("skips empty template entries", () => {
    const c = buildConfig(base({ templates: { item: "", race: "race2md.txt" } }));
    const t = c.template as Record<string, string>;
    expect(t.item).toBeUndefined();
    expect(t.race).toBe("examples/templates/tools5e/race2md.txt");
  });
  it("omits template object entirely when nothing chosen", () => {
    expect(buildConfig(base({ templates: {} })).template).toBeUndefined();
  });
});

describe("images", () => {
  it("includes fallbackPaths only when present", () => {
    expect((buildConfig(base()).images as any).fallbackPaths).toBeUndefined();
    const c = buildConfig(base({ images: { copyInternal: true, copyExternal: false, internalRoot: "i", fallbackPaths: { "a.jpg": "a.webp" } } }));
    expect((c.images as any).fallbackPaths).toEqual({ "a.jpg": "a.webp" });
  });
});

describe("configToFields (round-trip)", () => {
  it("reverses buildConfigJson back into form fields", () => {
    const input = base({
      sources: { adventure: "LMoP", book: "xPHB, xMM", reference: "MPMM", homebrew: "homebrew/a/x.json", defaultSource: { monster: "XMM" } },
      include: ["race|changeling|mpmm"],
      exclude: ["monster|expert|dc"],
      excludePattern: ["race\\|.*\\|dmg"],
      racesAsSpecies: true,
      onlyReferencedTables: true,
      useFantasyStatblocks: true,
      useDiceRoller: true,
      templates: { background: "images-background2md.txt", monster: "monster2md-yamlStatblock-body.txt" },
    });
    const f = configToFields(buildConfigJson(input));
    expect(f.adventure).toBe("LMoP");
    expect(f.book).toBe("xPHB, xMM");
    expect(f.reference).toBe("MPMM");
    expect(f.homebrew).toBe("homebrew/a/x.json");
    expect(f.defaultSource).toBe("monster=XMM");
    expect(f.include).toBe("race|changeling|mpmm");
    expect(f.exclude).toBe("monster|expert|dc");
    expect(f.excludePattern).toBe("race\\|.*\\|dmg");
    expect(f.racesAsSpecies).toBe(true);
    expect(f.onlyReferencedTables).toBe(true);
    expect(f.useFantasyStatblocks).toBe(true); // from yamlStatblocks
    expect(f.useDiceRoller).toBe(true);
    // template values reduce to basenames for the dropdowns
    expect(f.tpl_background).toBe("images-background2md.txt");
    expect(f.tpl_monster).toBe("monster2md-yamlStatblock-body.txt");
    expect(f.tpl_item).toBe(""); // not set in input
  });
  it("fills sensible defaults from a minimal config", () => {
    const f = configToFields('{"sources":{"book":["PHB"]}}');
    expect(f.book).toBe("PHB");
    expect(f.reprintBehavior).toBe("newest");
    expect(f.tagPrefix).toBe("ttrpg");
    expect(f.useFantasyStatblocks).toBe(false);
  });
  it("throws on invalid JSON", () => {
    expect(() => configToFields("{nope")).toThrow();
  });
});

describe("buildConfigJson", () => {
  it("round-trips and orders keys sensibly", () => {
    const json = buildConfigJson(base({ useFantasyStatblocks: true, include: ["x|y|z"], racesAsSpecies: true }));
    const parsed = JSON.parse(json);
    expect(parsed.include).toEqual(["x|y|z"]);
    expect(parsed.racesAsSpecies).toBe(true);
    expect(parsed.yamlStatblocks).toBe(true);
    const keys = Object.keys(parsed);
    expect(keys[0]).toBe("sources");
    expect(keys.indexOf("include")).toBeLessThan(keys.indexOf("reprintBehavior"));
  });
});
