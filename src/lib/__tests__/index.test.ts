import { describe, it, expect } from "vitest";
import { parseIndexKeys, filterKeys } from "../index";

describe("parseIndexKeys", () => {
  it("parses an array of key strings", () => {
    const text = JSON.stringify(["monster|goblin|mm", "spell|fireball|phb", "not-a-key"]);
    expect(parseIndexKeys(text)).toEqual(["monster|goblin|mm", "spell|fireball|phb"]);
  });
  it("parses an object keyed by data key", () => {
    const text = JSON.stringify({ "item|club|phb": {}, "monster|goblin|mm": { ok: true } });
    expect(parseIndexKeys(text)).toEqual(["item|club|phb", "monster|goblin|mm"]);
  });
  it("flattens key strings nested in array values", () => {
    const text = JSON.stringify({ groupA: ["race|elf|phb", "race|human|phb"] });
    expect(parseIndexKeys(text)).toContain("race|elf|phb");
  });
  it("dedupes and sorts", () => {
    const text = JSON.stringify(["b|x|s", "a|x|s", "b|x|s"]);
    expect(parseIndexKeys(text)).toEqual(["a|x|s", "b|x|s"]);
  });
  it("returns [] on invalid JSON", () => {
    expect(parseIndexKeys("{not json")).toEqual([]);
  });
});

describe("filterKeys", () => {
  const keys = ["monster|goblin|mm", "monster|orc|mm", "spell|fireball|phb"];
  it("filters case-insensitively by substring", () => {
    expect(filterKeys(keys, "GOBLIN")).toEqual(["monster|goblin|mm"]);
    expect(filterKeys(keys, "monster")).toHaveLength(2);
  });
  it("returns all (up to limit) for an empty query", () => {
    expect(filterKeys(keys, "")).toHaveLength(3);
    expect(filterKeys(keys, "", 2)).toHaveLength(2);
  });
});
