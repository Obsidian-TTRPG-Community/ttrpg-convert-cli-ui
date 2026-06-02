import { describe, it, expect } from "vitest";
import { normalizeVersion, isNewerVersion, pickAppUpdate } from "../update-check";

describe("normalizeVersion", () => {
  it("strips a leading v and trims", () => {
    expect(normalizeVersion("v2.1.0")).toBe("2.1.0");
    expect(normalizeVersion("  V2.1.0 ")).toBe("2.1.0");
    expect(normalizeVersion("2.1.0")).toBe("2.1.0");
  });
});

describe("isNewerVersion", () => {
  it("detects newer patch / minor / major", () => {
    expect(isNewerVersion("2.1.1", "2.1.0")).toBe(true);
    expect(isNewerVersion("2.2.0", "2.1.9")).toBe(true);
    expect(isNewerVersion("3.0.0", "2.9.9")).toBe(true);
  });

  it("is false for equal or older", () => {
    expect(isNewerVersion("2.1.0", "2.1.0")).toBe(false);
    expect(isNewerVersion("2.0.9", "2.1.0")).toBe(false);
    expect(isNewerVersion("1.9.9", "2.0.0")).toBe(false);
  });

  it("ignores leading v and prerelease/build suffixes", () => {
    expect(isNewerVersion("v2.1.1", "2.1.0")).toBe(true);
    expect(isNewerVersion("2.1.0-rc1", "2.1.0")).toBe(false); // same core → not newer
    expect(isNewerVersion("2.1.0", "2.1.0-rc1")).toBe(false); // core equal
    expect(isNewerVersion("2.1.1-rc1", "2.1.0")).toBe(true);
  });

  it("handles differing segment counts", () => {
    expect(isNewerVersion("2.1", "2.1.0")).toBe(false);
    expect(isNewerVersion("2.1.0.1", "2.1.0")).toBe(true);
  });
});

describe("pickAppUpdate", () => {
  const rel = (over: Record<string, unknown> = {}) => ({
    tag_name: "v2.2.0",
    html_url: "https://example.test/releases/v2.2.0",
    prerelease: false,
    draft: false,
    ...over,
  });

  it("returns the update when the release is newer and stable", () => {
    const u = pickAppUpdate(rel(), "2.1.0");
    expect(u).toEqual({
      version: "2.2.0",
      tag: "v2.2.0",
      url: "https://example.test/releases/v2.2.0",
    });
  });

  it("returns null when not newer", () => {
    expect(pickAppUpdate(rel({ tag_name: "v2.1.0" }), "2.1.0")).toBeNull();
    expect(pickAppUpdate(rel({ tag_name: "v2.0.0" }), "2.1.0")).toBeNull();
  });

  it("never prompts for drafts or prereleases", () => {
    expect(pickAppUpdate(rel({ prerelease: true }), "2.1.0")).toBeNull();
    expect(pickAppUpdate(rel({ draft: true }), "2.1.0")).toBeNull();
  });

  it("handles missing / malformed payloads", () => {
    expect(pickAppUpdate(null, "2.1.0")).toBeNull();
    expect(pickAppUpdate(undefined, "2.1.0")).toBeNull();
    expect(pickAppUpdate(rel({ tag_name: undefined }), "2.1.0")).toBeNull();
  });

  it("falls back to the releases page when html_url is absent", () => {
    const u = pickAppUpdate(rel({ html_url: undefined }), "2.1.0");
    expect(u?.url).toContain("github.com");
  });
});
