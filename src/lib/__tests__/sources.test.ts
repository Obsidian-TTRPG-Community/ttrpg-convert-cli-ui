import { describe, it, expect } from "vitest";
import { parseSourceList, mergeCodes } from "../sources";

describe("parseSourceList", () => {
  const books = JSON.stringify({
    book: [
      { name: "Monster Manual", id: "MM", source: "MM", group: "core" },
      { name: "Player's Handbook (2014)", id: "PHB", source: "PHB" },
      { name: "no id here" },
    ],
  });
  it("extracts id + name, sorted by name", () => {
    const r = parseSourceList(books, "book");
    expect(r.map((x) => x.id)).toEqual(["MM", "PHB"]); // Monster < Player's
    expect(r[0].name).toBe("Monster Manual");
  });
  it("keeps the group when present", () => {
    expect(parseSourceList(books, "book")[0].group).toBe("core");
  });
  it("reads adventures under the adventure key", () => {
    const adv = JSON.stringify({ adventure: [{ name: "Lost Mine", id: "LMoP" }] });
    expect(parseSourceList(adv, "adventure")).toEqual([{ id: "LMoP", name: "Lost Mine", group: undefined }]);
  });
  it("returns [] for the wrong key or bad json", () => {
    expect(parseSourceList(books, "adventure")).toEqual([]);
    expect(parseSourceList("{nope", "book")).toEqual([]);
  });
});

describe("mergeCodes", () => {
  it("appends new codes without duplicating", () => {
    expect(mergeCodes("PHB, MM", ["MM", "DMG"])).toBe("PHB, MM, DMG");
  });
  it("works from an empty field", () => {
    expect(mergeCodes("", ["PHB", "PHB"])).toBe("PHB");
  });
});
