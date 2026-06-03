import { describe, it, expect } from "vitest";
import { parseHomebrew, groupHomebrew, prettyCategory, matchesQuery } from "../homebrew";

const SAMPLE = [
  "book/2CGaming; Total Party Kill Bestiary - Vol. 1.json",
  "adventure/Kobold Press; Book of Lairs.json",
  "collection/Griffin Macaulay; The Griffon's Saddlebag, Book 1 - 2024.json",
  "creature/Kobold Press; Tome of Beasts 1 (2023 Edition).json",
  "spell/Someone; Extra Spells.json",
  "loose-at-root.json",
];

describe("prettyCategory", () => {
  it("maps known and unknown folders", () => {
    expect(prettyCategory("book")).toBe("Book");
    expect(prettyCategory("variantrule")).toBe("Variant Rule");
    expect(prettyCategory("widgets")).toBe("Widgets");
    expect(prettyCategory("")).toBe("Other");
  });
});

describe("parseHomebrew", () => {
  it("derives path, category, author and title", () => {
    const e = parseHomebrew(["book/2CGaming; Total Party Kill Bestiary - Vol. 1.json"])[0];
    expect(e.path).toBe("homebrew/book/2CGaming; Total Party Kill Bestiary - Vol. 1.json");
    expect(e.category).toBe("Book");
    expect(e.author).toBe("2CGaming");
    expect(e.title).toBe("Total Party Kill Bestiary - Vol. 1");
  });

  it("keeps comma-containing titles intact", () => {
    const e = parseHomebrew(["collection/Griffin Macaulay; The Griffon's Saddlebag, Book 1 - 2024.json"])[0];
    expect(e.title).toBe("The Griffon's Saddlebag, Book 1 - 2024");
    expect(e.path).toBe("homebrew/collection/Griffin Macaulay; The Griffon's Saddlebag, Book 1 - 2024.json");
  });

  it("handles files with no author separator and files at the root", () => {
    const [noAuthor] = parseHomebrew(["book/Plain Title.json"]);
    expect(noAuthor.author).toBe("");
    expect(noAuthor.title).toBe("Plain Title");
    const [root] = parseHomebrew(["loose-at-root.json"]);
    expect(root.category).toBe("Other");
    expect(root.path).toBe("homebrew/loose-at-root.json");
  });

  it("ignores non-json and de-duplicates", () => {
    const out = parseHomebrew(["book/A; X.json", "book/A; X.json", "book/readme.md", ""]);
    expect(out).toHaveLength(1);
  });
});

describe("groupHomebrew", () => {
  it("groups by category with the big source types first", () => {
    const groups = groupHomebrew(parseHomebrew(SAMPLE));
    const order = groups.map((g) => g.category);
    expect(order.slice(0, 4)).toEqual(["Collection", "Book", "Adventure", "Creature"]);
    expect(order).toContain("Spell");
    expect(order).toContain("Other");
  });

  it("sorts entries by title within a category", () => {
    const groups = groupHomebrew(parseHomebrew([
      "book/Z; Zeta.json", "book/A; Alpha.json", "book/M; Mid.json",
    ]));
    expect(groups[0].entries.map((e) => e.title)).toEqual(["Alpha", "Mid", "Zeta"]);
  });
});

describe("matchesQuery", () => {
  const [e] = parseHomebrew(["creature/Kobold Press; Tome of Beasts 1 (2023 Edition).json"]);
  it("matches title, author and category, case-insensitively", () => {
    expect(matchesQuery(e, "tome of beasts")).toBe(true);
    expect(matchesQuery(e, "KOBOLD")).toBe(true);
    expect(matchesQuery(e, "creature")).toBe(true);
    expect(matchesQuery(e, "")).toBe(true);
    expect(matchesQuery(e, "spelljammer")).toBe(false);
  });
});
